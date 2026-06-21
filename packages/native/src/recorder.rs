use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

#[napi(object)]
pub struct RecordConfig {
    pub backend: String,          // "wgc" | "dxgi"
    pub target_hwnd: Option<i64>,
    pub fps: Option<u32>,         // default 5
    pub output_dir: String,
}

#[napi(object)]
pub struct RecordResult {
    pub session_id: String,
    pub backend: String,
    pub frame_count: u32,
    pub duration_ms: i64,
    pub output_path: String,
    pub dropped_frames: u32,
}

#[napi(object)]
pub struct RecordingStatus {
    pub session_id: String,
    pub is_recording: bool,
    pub frame_count: u32,
    pub elapsed_ms: i64,
}

struct RecordingSession {
    session_id: String,
    backend: String,
    start_time: Instant,
    frame_count: Arc<Mutex<u32>>,
    is_recording: Arc<Mutex<bool>>,
    output_dir: PathBuf,
}

lazy_static::lazy_static! {
    static ref SESSIONS: Mutex<HashMap<String, RecordingSession>> = Mutex::new(HashMap::new());
}

// NOTE: Actual WGC/DXGI capture implementation will be filled in after
// Phase 0 confirms these crates compile successfully. The functions below
// are state-management skeletons only.

#[napi]
pub fn start_recording_wgc(config: RecordConfig) -> Result<String> {
    let session_id = Uuid::new_v4().to_string();
    let output_dir = PathBuf::from(&config.output_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| Error::from_reason(format!("mkdir: {}", e)))?;

    let frame_count = Arc::new(Mutex::new(0u32));
    let is_recording = Arc::new(Mutex::new(true));

    // WGC capture start -- actual implementation will use
    // windows_capture::capture::GraphicsCaptureSession
    // Phase 0: state management skeleton only
    let session = RecordingSession {
        session_id: session_id.clone(),
        backend: "wgc".to_string(),
        start_time: Instant::now(),
        frame_count: frame_count.clone(),
        is_recording: is_recording.clone(),
        output_dir,
    };

    SESSIONS.lock().insert(session_id.clone(), session);
    Ok(session_id)
}

#[napi]
pub fn start_recording_dxgi(config: RecordConfig) -> Result<String> {
    let session_id = Uuid::new_v4().to_string();
    let output_dir = PathBuf::from(&config.output_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| Error::from_reason(format!("mkdir: {}", e)))?;

    let frame_count = Arc::new(Mutex::new(0u32));
    let is_recording = Arc::new(Mutex::new(true));

    // DXGI capture start -- actual implementation will use
    // win_desktop_duplication crate (behind "dxgi" feature flag)
    // Phase 0: state management skeleton only
    let session = RecordingSession {
        session_id: session_id.clone(),
        backend: "dxgi".to_string(),
        start_time: Instant::now(),
        frame_count: frame_count.clone(),
        is_recording: is_recording.clone(),
        output_dir,
    };

    SESSIONS.lock().insert(session_id.clone(), session);
    Ok(session_id)
}

#[napi]
pub fn stop_recording(session_id: String) -> Result<RecordResult> {
    let mut sessions = SESSIONS.lock();
    let session = sessions.remove(&session_id)
        .ok_or_else(|| Error::from_reason(format!("Session {} not found", session_id)))?;

    *session.is_recording.lock() = false;
    let frame_count = *session.frame_count.lock();
    let duration = session.start_time.elapsed();

    Ok(RecordResult {
        session_id,
        backend: session.backend,
        frame_count,
        duration_ms: duration.as_millis() as i64,
        output_path: session.output_dir.to_string_lossy().to_string(),
        dropped_frames: 0,
    })
}

#[napi]
pub fn get_recording_status(session_id: String) -> Result<RecordingStatus> {
    let sessions = SESSIONS.lock();
    let session = sessions.get(&session_id)
        .ok_or_else(|| Error::from_reason(format!("Session {} not found", session_id)))?;

    let sid = session.session_id.clone();
    let recording = *session.is_recording.lock();
    let frames = *session.frame_count.lock();
    let elapsed = session.start_time.elapsed().as_millis() as i64;

    Ok(RecordingStatus {
        session_id: sid,
        is_recording: recording,
        frame_count: frames,
        elapsed_ms: elapsed,
    })
}

#[napi]
pub fn force_stop_all_recordings() -> Result<()> {
    let mut sessions = SESSIONS.lock();
    for (_, session) in sessions.iter() {
        *session.is_recording.lock() = false;
    }
    sessions.clear();
    Ok(())
}
