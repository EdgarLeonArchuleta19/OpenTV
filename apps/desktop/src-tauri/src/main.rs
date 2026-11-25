#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appearance;
mod audio_win;
mod capture;
mod commands;
mod updater;

use std::fs::{self, OpenOptions};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use opentv_core::config::ServiceConfig;
use opentv_core::start_server_with_state;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::webview::Color;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

use crate::commands::AppCtx;
use crate::updater::DesktopUpdater;

fn random_token() -> String {
    let mut b = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut b);
    let mut out = String::with_capacity(48);
    for byte in b {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn resolve_user_data_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("OPENTV_USER_DATA") {
        if !override_dir.trim().is_empty() {
            return PathBuf::from(override_dir);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for name in ["OpenTV - datos", "data"] {
                let cand = exe_dir.join(name);
                if cand.is_dir() {
                    return cand;
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("OpenTV-Tauri");
    }
    std::env::temp_dir().join("OpenTV-Tauri")
}

fn resolve_downloads_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Ok(profile) = std::env::var("USERPROFILE") {
        return PathBuf::from(profile).join("Videos").join("OpenTV");
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Videos").join("OpenTV");
    }
    std::env::temp_dir().join("OpenTV-Downloads")
}

fn find_tmdb_config() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("config").join("tmdb.json"));
            // Dev layout: apps/desktop/src-tauri/target/debug -> repo root
            for anc in dir.ancestors().take(7) {
                candidates.push(anc.join("config").join("tmdb.json"));
            }
        }
    }
    candidates.push(PathBuf::from("config/tmdb.json"));
    candidates.into_iter().find(|p| p.is_file())
}

/// TMDB credentials embedded at build time by `build.rs` (obfuscated, never logged).
/// Used only when no `config/tmdb.json` is found next to the executable / in the dev tree.
fn embedded_tmdb_json() -> Option<String> {
    static BLOB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/tmdb.bin"));
    if BLOB.len() < 10 || BLOB[0] != 1 {
        return None;
    }
    let mut seed_bytes = [0u8; 8];
    seed_bytes.copy_from_slice(&BLOB[1..9]);
    let seed = u64::from_le_bytes(seed_bytes);
    let mut st = (seed ^ 0x6F70_656E_7476_746D).max(1);
    let plain: Vec<u8> = BLOB[9..]
        .iter()
        .map(|b| {
            // Same xorshift stream as build.rs.
            st ^= st << 13;
            st ^= st >> 7;
            st ^= st << 17;
            b ^ ((st >> 24) as u8)
        })
        .collect();
    String::from_utf8(plain).ok().filter(|s| !s.trim().is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
}

fn load_window_state(user_data_dir: &Path) -> Option<WindowState> {
    let raw = fs::read_to_string(user_data_dir.join("window-state.json")).ok()?;
    let st: WindowState = serde_json::from_str(&raw).ok()?;
    if st.width < 960 || st.height < 600 || st.width > 8000 || st.height > 5000 {
        return None;
    }
    if st.x < -4000 || st.y < -4000 || st.x > 8000 || st.y > 5000 {
        return None;
    }
    Some(st)
}

fn save_window_state(user_data_dir: &Path, win: &tauri::WebviewWindow) {
    if win.is_minimized().unwrap_or(false) || win.is_fullscreen().unwrap_or(false) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    let Ok(size) = win.inner_size() else { return };
    let Ok(pos) = win.outer_position() else { return };
    let st = WindowState {
        width: size.width.max(960),
        height: size.height.max(600),
        x: pos.x,
        y: pos.y,
        maximized,
    };
    if let Ok(text) = serde_json::to_string_pretty(&st) {
        let _ = fs::write(user_data_dir.join("window-state.json"), text);
    }
}

fn append_log(user_data_dir: &Path, line: &str) {
    let log_dir = user_data_dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let log_file = log_dir.join("opentv.log");
    // Rotate if log exceeds 512 KB
    if fs::metadata(&log_file).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = fs::write(&log_file, "");
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_file) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "[{ts}] {line}");
    }
}

/// Windows-only polish for the frameless window:
/// - Hides the WebView2 status bar that pops up bottom-left with URLs such as
///   `http://tauri.localhost/...` when the pointer hovers a link.
/// - Paints the DWM 1px window border in the dark theme tone until the UI applies the
///   saved theme (`desktop_appearance`).
#[cfg(target_os = "windows")]
fn apply_windows_chrome(win: &tauri::WebviewWindow) {
    let _ = win.with_webview(|wv| unsafe {
        if let Ok(core) = wv.controller().CoreWebView2() {
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetIsStatusBarEnabled(false);
            }
        }
    });

    appearance::apply_border_color(win, false);
}

fn main() {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let user_data_dir = resolve_user_data_dir();
    let downloads_dir = resolve_downloads_dir();
    let _ = fs::create_dir_all(&user_data_dir);
    let _ = fs::create_dir_all(&downloads_dir);
    append_log(&user_data_dir, &format!("Iniciando OpenTV v{version} (Tauri v2)"));

    let token = random_token();
    let tmdb_config_path = find_tmdb_config();
    let tmdb_inline_json = if tmdb_config_path.is_none() { embedded_tmdb_json() } else { None };
    let cfg = ServiceConfig {
        port: 0,
        auth_token: Some(token.clone()),
        tmdb_config_path,
        tmdb_inline_json,
        platform: "desktop".to_string(),
        downloads_dir: Some(downloads_dir.clone()),
        cache_dir: Some(user_data_dir.clone()),
        low_memory: false,
        app_version: Some(version.clone()),
        ..Default::default()
    };

    // Start the unified Rust core in-process on 127.0.0.1:<random_port> before the window loads.
    let (bound_addr, core_state, shutdown_tx) = tauri::async_runtime::block_on(async move {
        start_server_with_state(cfg)
            .await
            .expect("No se pudo iniciar el servicio interno de OpenTV")
    });
    let proxy_port = bound_addr.port();
    commands::load_approved_network_paths(&core_state, &user_data_dir);
    eprintln!("[opentv-tauri] core listo en 127.0.0.1:{proxy_port}");
    append_log(&user_data_dir, &format!("Núcleo Rust listo en 127.0.0.1:{proxy_port}"));

    let shutdown_slot: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(Some(shutdown_tx));
    let core_for_exit = core_state.clone();
    let user_data_for_run = user_data_dir.clone();
    let updater = DesktopUpdater::new(version.clone(), user_data_dir.clone());

    let ctx = AppCtx {
        core: core_state.clone(),
        updater: updater.clone(),
        version: version.clone(),
        user_data_dir: user_data_dir.clone(),
        downloads_dir,
        pinned: AtomicBool::new(false),
        fullscreen: AtomicBool::new(false),
    };

    let init_script = format!(
        "(function(){{if(window.self===window.top&&location.origin!=='null'){{window.__OPENTV_TAURI_INIT__={{port:{},version:{:?},token:{:?}}};}}}})();",
        proxy_port, version, token
    );

    let app = tauri::Builder::default()
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![
            commands::desktop_service,
            commands::desktop_tmdb,
            commands::desktop_fullscreen,
            commands::desktop_pin,
            commands::desktop_win_control,
            commands::desktop_system_volume,
            commands::desktop_backup,
            commands::desktop_open_downloads,
            commands::desktop_open_logs,
            commands::desktop_clear_cache,
            commands::desktop_open_addon_config,
            commands::desktop_browser_capture,
            commands::desktop_update,
            commands::desktop_info,
            commands::desktop_pick_local_video,
            commands::desktop_pick_local_folder,
            appearance::desktop_appearance,
        ])
        .setup(move |app| {
            let webview_data = user_data_dir.join("webview2");
            let _ = fs::create_dir_all(&webview_data);
            let saved_win = load_window_state(&user_data_dir);

            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("OpenTV")
            .inner_size(1360.0, 840.0)
            .min_inner_size(960.0, 600.0)
            .decorations(false)
            .shadow(true)
            .resizable(true)
            .background_color(Color(14, 14, 17, 255))
            .data_directory(webview_data)
            .initialization_script(&init_script)
            .on_navigation(|url| {
                let s = url.as_str();
                #[cfg(debug_assertions)]
                if s.starts_with("http://localhost:5173/") || s == "http://localhost:5173" {
                    return true;
                }
                s == "about:blank"
                    || s.starts_with("http://tauri.localhost/")
                    || s.starts_with("https://tauri.localhost/")
                    || s.starts_with("tauri://localhost/")
            });

            if saved_win.is_none() {
                builder = builder.center();
            }

            #[cfg(target_os = "windows")]
            {
                builder = builder.additional_browser_args("--autoplay-policy=no-user-gesture-required");
            }

            let main_win = builder.build()?;
            #[cfg(target_os = "windows")]
            apply_windows_chrome(&main_win);
            if let Some(st) = saved_win {
                let _ = main_win.set_size(PhysicalSize::new(st.width, st.height));
                let _ = main_win.set_position(PhysicalPosition::new(st.x, st.y));
                if st.maximized {
                    let _ = main_win.maximize();
                }
            }
            let _ = main_win.set_focus();

            // Immediate startup update check (2s after window ready) + periodic re-check every 4 hours.
            // If a persisted lock was already loaded on startup, emit it right away too.
            let win_upd = main_win.clone();
            let http_upd = core_state.http.clone();
            let upd = updater.clone();
            tauri::async_runtime::spawn(async move {
                let initial = upd.current().await;
                if initial["mandatory"].as_bool().unwrap_or(false) {
                    let _ = win_upd.emit("desktop:update-status", initial);
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                loop {
                    let st = upd.check(&http_upd).await;
                    let _ = win_upd.emit("desktop:update-status", st);
                    tokio::time::sleep(std::time::Duration::from_secs(4 * 60 * 60)).await;
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("No se pudo construir la aplicación OpenTV Tauri");

    app.run(move |app_handle, event| {
        match event {
            RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }),
                ..
            } if label == "main" => {
                let list: Vec<String> = paths
                    .into_iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                if !list.is_empty() {
                    if let Some(w) = app_handle.get_webview_window("main") {
                        let _ = w.emit("desktop:file-drop", list);
                    }
                }
            }
            RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } if label == "main" => {
                if let Some(w) = app_handle.get_webview_window("main") {
                    save_window_state(&user_data_for_run, &w);
                }
                append_log(&user_data_for_run, "Cerrando OpenTV");
                // Closing the main window should close any hidden capture webview too.
                app_handle.exit(0);
            }
            RunEvent::Exit => {
                let core_stop = core_for_exit.clone();
                let _ = tauri::async_runtime::block_on(async move {
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_secs(2),
                        async {
                            core_stop.transcode.stop().await;
                            core_stop.torrents.stop().await;
                        },
                    )
                    .await;
                });
                if let Ok(mut guard) = shutdown_slot.lock() {
                    if let Some(tx) = guard.take() {
                        let _ = tx.send(());
                    }
                }
            }
            _ => {}
        }
    });
}
