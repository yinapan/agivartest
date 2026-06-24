use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Instant;
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
    PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HC_ACTION,
    HHOOK, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDBLCLK, WM_LBUTTONDOWN,
    WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

#[napi(object)]
pub struct EventCaptureConfig {
    pub scope: String,
    pub privacy_mode: String,
    pub target_hwnd: Option<i64>,
    pub window_title: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct NativeCapturedEvent {
    pub id: String,
    pub session_id: String,
    pub timestamp_ms: i64,
    #[napi(js_name = "type")]
    pub event_type: String,
    pub summary: String,
    pub redaction_level: String,
    pub window_title: Option<String>,
    pub process_name: Option<String>,
    pub status: String,
}

struct EventCaptureSession {
    session_id: String,
    privacy_mode: String,
    window_title: Option<String>,
    start_time: Instant,
    events: Vec<NativeCapturedEvent>,
    thread_id: u32,
    worker: Option<JoinHandle<()>>,
}

lazy_static::lazy_static! {
    static ref EVENT_SESSIONS: Mutex<HashMap<String, EventCaptureSession>> = Mutex::new(HashMap::new());
    static ref ACTIVE_SESSION_ID: Mutex<Option<String>> = Mutex::new(None);
}

#[napi]
pub fn start_event_capture(session_id: String, config: EventCaptureConfig) -> Result<()> {
    if EVENT_SESSIONS.lock().contains_key(&session_id) {
        return Err(Error::from_reason(format!(
            "Event capture session {} already exists",
            session_id
        )));
    }

    let (tx, rx) = mpsc::channel::<Result<u32>>();
    let worker = thread::spawn(move || {
        match install_hooks() {
            Ok((thread_id, keyboard_hook, mouse_hook)) => {
                let _ = tx.send(Ok(thread_id));
                run_message_loop(keyboard_hook, mouse_hook);
            }
            Err(err) => {
                let _ = tx.send(Err(err));
            }
        }
    });

    let thread_id = rx
        .recv()
        .map_err(|e| Error::from_reason(format!("event hook thread failed: {}", e)))??;

    ACTIVE_SESSION_ID.lock().replace(session_id.clone());
    EVENT_SESSIONS.lock().insert(
        session_id.clone(),
        EventCaptureSession {
            session_id,
            privacy_mode: config.privacy_mode,
            window_title: config.window_title,
            start_time: Instant::now(),
            events: Vec::new(),
            thread_id,
            worker: Some(worker),
        },
    );
    Ok(())
}

#[napi]
pub fn stop_event_capture(session_id: String) -> Result<()> {
    let worker = {
        let mut sessions = EVENT_SESSIONS.lock();
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| Error::from_reason(format!("Event capture session {} not found", session_id)))?;

        unsafe {
            let _ = PostThreadMessageW(session.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        session.worker.take()
    };

    if let Some(worker) = worker {
        worker
            .join()
            .map_err(|_| Error::from_reason("event hook thread panicked".to_string()))?;
    }

    let mut active = ACTIVE_SESSION_ID.lock();
    if active.as_deref() == Some(&session_id) {
        active.take();
    }
    Ok(())
}

#[napi]
pub fn drain_events(session_id: String) -> Result<Vec<NativeCapturedEvent>> {
    let mut sessions = EVENT_SESSIONS.lock();
    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| Error::from_reason(format!("Event capture session {} not found", session_id)))?;
    Ok(session.events.drain(..).collect())
}

fn install_hooks() -> Result<(u32, HHOOK, HHOOK)> {
    unsafe {
        let module = GetModuleHandleW(None)
            .map_err(|e| Error::from_reason(format!("GetModuleHandleW: {}", e)))?;
        let thread_id = windows::Win32::System::Threading::GetCurrentThreadId();

        let keyboard_hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_proc),
            HINSTANCE(module.0),
            0,
        )
        .map_err(|e| Error::from_reason(format!("SetWindowsHookExW keyboard: {}", e)))?;
        let mouse_hook = SetWindowsHookExW(
            WH_MOUSE_LL,
            Some(mouse_proc),
            HINSTANCE(module.0),
            0,
        )
        .map_err(|e| {
            let _ = UnhookWindowsHookEx(keyboard_hook);
            Error::from_reason(format!("SetWindowsHookExW mouse: {}", e))
        })?;

        Ok((thread_id, keyboard_hook, mouse_hook))
    }
}

fn run_message_loop(keyboard_hook: HHOOK, mouse_hook: HHOOK) {
    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = UnhookWindowsHookEx(keyboard_hook);
        let _ = UnhookWindowsHookEx(mouse_hook);
    }
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let event = match wparam.0 as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => Some(("hotkey", "Key down")),
            WM_KEYUP | WM_SYSKEYUP => Some(("hotkey", "Key up")),
            _ => None,
        };
        if let Some((event_type, summary)) = event {
            let _keyboard = *(lparam.0 as *const KBDLLHOOKSTRUCT);
            record_event(event_type, summary);
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let _mouse = *(lparam.0 as *const MSLLHOOKSTRUCT);
        let event = match wparam.0 as u32 {
            WM_LBUTTONDOWN | WM_RBUTTONDOWN => Some(("click", "Mouse click")),
            WM_LBUTTONDBLCLK => Some(("double-click", "Mouse double click")),
            WM_MOUSEWHEEL => Some(("scroll", "Mouse wheel")),
            _ => None,
        };
        if let Some((event_type, summary)) = event {
            record_event(event_type, summary);
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

fn record_event(event_type: &str, summary: &str) {
    let session_id = match ACTIVE_SESSION_ID.lock().clone() {
        Some(session_id) => session_id,
        None => return,
    };
    let mut sessions = EVENT_SESSIONS.lock();
    let Some(session) = sessions.get_mut(&session_id) else {
        return;
    };
    let timestamp_ms = session.start_time.elapsed().as_millis() as i64;
    let ordinal = session.events.len() + 1;
    session.events.push(NativeCapturedEvent {
        id: format!("{}-native-event-{}", session.session_id, ordinal),
        session_id: session.session_id.clone(),
        timestamp_ms,
        event_type: event_type.to_string(),
        summary: summary.to_string(),
        redaction_level: session.privacy_mode.clone(),
        window_title: session.window_title.clone(),
        process_name: None,
        status: "active".to_string(),
    });
}
