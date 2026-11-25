//! Native side of Ajustes -> Apariencia: theme colours of the frameless window and the
//! WebView zoom behind "Texto aumentado" (scales every screen, Ajustes included).

use tauri::webview::Color;
use tauri::WebviewWindow;

/// Window background behind the WebView (`--ot-bg` of each theme).
fn background(light: bool) -> Color {
    if light {
        Color(246, 246, 248, 255)
    } else {
        Color(14, 14, 17, 255)
    }
}

/// Paints the DWM 1px window border in a neutral tone for the theme; otherwise Windows 11
/// draws it with the system accent colour (usually blue) whenever the window is not maximised.
#[cfg(target_os = "windows")]
pub fn apply_border_color(win: &WebviewWindow, light: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR};
    let Ok(hwnd) = win.hwnd() else { return };
    // COLORREF is 0x00BBGGRR: #232328 on the dark theme, #d4d4da on the light one.
    let color: u32 = if light { 0x00DA_D4D4 } else { 0x0028_2323 };
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(hwnd.0 as _),
            DWMWA_BORDER_COLOR,
            &color as *const u32 as *const core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

/// Clamps the requested WebView zoom to the range the UI is designed for.
fn sanitize_zoom(zoom: f64) -> f64 {
    if zoom.is_finite() {
        zoom.clamp(1.0, 1.25)
    } else {
        1.0
    }
}

#[tauri::command]
pub fn desktop_appearance(window: WebviewWindow, theme: String, zoom: f64) -> bool {
    if window.label() != "main" {
        return false;
    }
    let light = theme == "light";
    let _ = window.set_background_color(Some(background(light)));
    #[cfg(target_os = "windows")]
    apply_border_color(&window, light);
    window.set_zoom(sanitize_zoom(zoom)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::sanitize_zoom;

    #[test]
    fn zoom_is_clamped() {
        assert_eq!(sanitize_zoom(1.12), 1.12);
        assert_eq!(sanitize_zoom(0.2), 1.0);
        assert_eq!(sanitize_zoom(9.0), 1.25);
        assert_eq!(sanitize_zoom(f64::NAN), 1.0);
    }
}
