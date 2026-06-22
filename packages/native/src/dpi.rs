use napi::bindgen_prelude::*;
use napi_derive::napi;
use windows::Win32::Foundation::{BOOL, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForSystem, MDT_EFFECTIVE_DPI};

#[napi]
pub fn get_dpi_for_monitor(monitor_index: u32) -> Result<u32> {
    unsafe {
        let mut monitors: Vec<HMONITOR> = Vec::new();

        extern "system" fn enum_callback(
            hmonitor: HMONITOR,
            _hdc: HDC,
            _rect: *mut RECT,
            lparam: LPARAM,
        ) -> BOOL {
            let monitors = unsafe { &mut *(lparam.0 as *mut Vec<HMONITOR>) };
            monitors.push(hmonitor);
            TRUE
        }

        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(enum_callback),
            LPARAM(&mut monitors as *mut _ as isize),
        );

        if monitor_index as usize >= monitors.len() {
            return Err(Error::from_reason(format!(
                "Monitor {} not found, only {} available",
                monitor_index,
                monitors.len()
            )));
        }

        let hmonitor = monitors[monitor_index as usize];
        let mut dpi_x: u32 = 96;
        let mut dpi_y: u32 = 96;

        GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y)
            .map_err(|e| Error::from_reason(format!("GetDpiForMonitor: {}", e)))?;

        Ok(dpi_x)
    }
}

#[napi]
pub fn get_monitor_count() -> Result<u32> {
    unsafe {
        let mut count: u32 = 0;

        extern "system" fn count_callback(
            _hmonitor: HMONITOR,
            _hdc: HDC,
            _rect: *mut RECT,
            lparam: LPARAM,
        ) -> BOOL {
            let count = unsafe { &mut *(lparam.0 as *mut u32) };
            *count += 1;
            TRUE
        }

        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(count_callback),
            LPARAM(&mut count as *mut _ as isize),
        );

        Ok(count)
    }
}

#[napi]
pub fn get_system_dpi() -> u32 {
    unsafe { GetDpiForSystem() }
}
