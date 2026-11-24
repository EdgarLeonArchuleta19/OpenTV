use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use opentv_core::rpc::dispatch;
use opentv_core::ServiceState;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use url::Url;

use crate::audio_win;
use crate::capture;
use crate::updater::DesktopUpdater;

const ALLOWED_METHODS: &[&str] = &[
    "tmdb",
    "ping",
    "keepAlive",
    "heartbeat",
    "resolveExternal",
    "videoHash",
    "proxySubtitles",
    "subtitleCat",
    "resolveShortCode",
    "pluginFetch",
    "netguardCheck",
    "torrentStart",
    "torrentProbe",
    "torrentStats",
    "torrentStop",
    "downloadStart",
    "downloadList",
    "downloadSnapshot",
    "downloadAction",
    "downloadOpen",
    "localRegister",
    "localScanFolder",
    "fetchM3u",
    "epg",
    "epgSchedule",
    "resolveLive",
    "abortMedia",
    "mediaProbe",
    "compatStart",
    "compatStop",
    "appUpdate",
];

pub struct AppCtx {
    pub core: ServiceState,
    pub updater: DesktopUpdater,
    pub version: String,
    pub user_data_dir: PathBuf,
    pub downloads_dir: PathBuf,
    pub pinned: AtomicBool,
    pub fullscreen: AtomicBool,
}

fn ensure_main(window: &WebviewWindow) -> bool {
    window.label() == "main"
}

fn open_with_os(target: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::{w, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide: Vec<u16> = OsStr::new(target).encode_wide().chain(Some(0)).collect();
        let ret = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                PCWSTR(wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        (ret.0 as isize) > 32
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target;
        false
    }
}

fn reveal_in_explorer(file: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let arg = format!("/select,{}", file.display());
        Command::new("explorer.exe").arg(arg).spawn().is_ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = file;
        false
    }
}

fn backup_file_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents"));
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var_os("HOME").map(|p| PathBuf::from(p).join("Documents"));
    base.map(|d| d.join("OpenTV").join("backup.json"))
}

#[tauri::command]
pub async fn desktop_service(
    window: WebviewWindow,
    ctx: State<'_, AppCtx>,
    method: String,
    parameters: Option<Value>,
) -> Result<Value, String> {
    if !ensure_main(&window) || !ALLOWED_METHODS.contains(&method.as_str()) {
        return Ok(json!({ "returnValue": false, "errorText": "Operación no permitida" }));
    }
    let params = match parameters {
        Some(Value::Object(m)) => Value::Object(m),
        _ => json!({}),
    };
    Ok(dispatch(&ctx.core, &method, &params).await)
}

#[tauri::command]
pub async fn desktop_tmdb(
    window: WebviewWindow,
    ctx: State<'_, AppCtx>,
    list: String,
) -> Result<Value, String> {
    if !ensure_main(&window) {
        return Ok(json!({ "error": "Operación no permitida" }));
    }
    let res = ctx.core.tmdb.list(&list).await;
    Ok(res)
}

#[tauri::command]
pub fn desktop_fullscreen(
    window: WebviewWindow,
    ctx: State<'_, AppCtx>,
    flag: Option<Value>,
) -> bool {
    if !ensure_main(&window) {
        return false;
    }
    let cur = window
        .is_fullscreen()
        .unwrap_or_else(|_| ctx.fullscreen.load(Ordering::Relaxed));
    if flag.as_ref().and_then(|v| v.as_str()) == Some("query") {
        return cur;
    }
    let next = match flag.and_then(|v| v.as_bool()) {
        Some(b) => b,
        None => !cur,
    };
    let _ = window.set_fullscreen(next);
    ctx.fullscreen.store(next, Ordering::Relaxed);
    let _ = window.emit("desktop:fullscreen-changed", next);
    next
}

#[tauri::command]
pub fn desktop_pin(window: WebviewWindow, ctx: State<'_, AppCtx>, flag: Option<Value>) -> bool {
    if !ensure_main(&window) {
        return false;
    }
    let cur = ctx.pinned.load(Ordering::Relaxed);
    if flag.as_ref().and_then(|v| v.as_str()) == Some("query") {
        return cur;
    }
    let next = match flag.and_then(|v| v.as_bool()) {
        Some(b) => b,
        None => !cur,
    };
    ctx.pinned.store(next, Ordering::Relaxed);
    let _ = window.set_always_on_top(next);
    next
}

#[tauri::command]
pub fn desktop_win_control(window: WebviewWindow, action: String) -> bool {
    if !ensure_main(&window) {
        return false;
    }
    match action.as_str() {
        "min" => window.minimize().is_ok(),
        "max" => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
                false
            } else {
                let _ = window.maximize();
                true
            }
        }
        "close" => window.close().is_ok(),
        _ => false,
    }
}

#[tauri::command]
pub async fn desktop_system_volume(
    window: WebviewWindow,
    command: String,
    value: Option<Value>,
) -> Value {
    if !ensure_main(&window) || !matches!(command.as_str(), "get" | "set" | "mute") {
        return json!({ "error": "Operación no permitida" });
    }
    tokio::task::spawn_blocking(move || audio_win::system_volume(&command, value))
        .await
        .unwrap_or_else(|_| json!({ "error": "Error de audio" }))
}

const MAX_BACKUP_BYTES: usize = 5 * 1024 * 1024;

#[tauri::command]
pub fn desktop_backup(
    window: WebviewWindow,
    command: String,
    data: Option<Value>,
) -> Value {
    if !ensure_main(&window) {
        return Value::Null;
    }
    let Some(file) = backup_file_path() else {
        return Value::Null;
    };
    match command.as_str() {
        "read" => {
            if fs::metadata(&file).map(|m| m.len() > MAX_BACKUP_BYTES as u64).unwrap_or(false) {
                return Value::Null;
            }
            fs::read_to_string(&file)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .unwrap_or(Value::Null)
        }
        "write" => {
            let Some(val) = data else {
                return Value::Bool(false);
            };
            if !val.is_object() {
                return Value::Bool(false);
            }
            if let Some(parent) = file.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let tmp = file.with_extension("json.tmp");
            if let Ok(text) = serde_json::to_string(&val) {
                if text.len() > MAX_BACKUP_BYTES {
                    return Value::Bool(false);
                }
                if fs::write(&tmp, text).is_ok() && fs::rename(&tmp, &file).is_ok() {
                    return Value::Bool(true);
                }
            }
            Value::Bool(false)
        }
        _ => Value::Null,
    }
}

#[tauri::command]
pub fn desktop_open_downloads(window: WebviewWindow, ctx: State<'_, AppCtx>) -> bool {
    if !ensure_main(&window) {
        return false;
    }
    let _ = fs::create_dir_all(&ctx.downloads_dir);
    open_with_os(&ctx.downloads_dir.to_string_lossy())
}

#[tauri::command]
pub fn desktop_open_logs(window: WebviewWindow, ctx: State<'_, AppCtx>) -> bool {
    if !ensure_main(&window) {
        return false;
    }
    let log_dir = ctx.user_data_dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let log_file = log_dir.join("opentv.log");
    if !log_file.exists() {
        let _ = fs::write(&log_file, "OpenTV Tauri v2 log\n");
    }
    reveal_in_explorer(&log_file)
}

/// "Borrar caché": deletes the Rust `/img` sized-image cache and the WebView2 HTTP disk cache.
/// Never touches profiles, lists, progress (localStorage), backups, logs or downloads.
#[tauri::command]
pub fn desktop_clear_cache(window: WebviewWindow, ctx: State<'_, AppCtx>) -> Value {
    if !ensure_main(&window) {
        return json!({ "ok": false });
    }
    let img_dir = ctx.core.config.resolved_cache_dir().join("sized-images");
    let (mut files, mut bytes) = (0u64, 0u64);
    if let Ok(rd) = fs::read_dir(&img_dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if fs::remove_file(&path).is_ok() {
                files += 1;
                bytes += len;
            }
        }
    }
    let webview_cache = clear_webview_disk_cache(&window);
    json!({ "ok": true, "files": files, "bytes": bytes, "webviewCache": webview_cache })
}

#[cfg(target_os = "windows")]
fn clear_webview_disk_cache(window: &WebviewWindow) -> bool {
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
    };
    use windows_core::Interface;

    window
        .with_webview(|wv| unsafe {
            let Ok(core) = wv.controller().CoreWebView2() else { return };
            let Ok(core13) = core.cast::<ICoreWebView2_13>() else { return };
            let Ok(profile) = core13.Profile() else { return };
            let Ok(profile2) = profile.cast::<ICoreWebView2Profile2>() else { return };
            let handler = ClearBrowsingDataCompletedHandler::create(Box::new(|_| Ok(())));
            let _ = profile2.ClearBrowsingData(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, &handler);
        })
        .is_ok()
}

#[cfg(not(target_os = "windows"))]
fn clear_webview_disk_cache(_window: &WebviewWindow) -> bool {
    false
}

#[tauri::command]
pub fn desktop_open_addon_config(window: WebviewWindow, url: String) -> bool {
    if !ensure_main(&window) || url.len() > 2048 {
        return false;
    }
    let Ok(parsed) = Url::parse(&url) else {
        return false;
    };
    let path = parsed.path();
    if parsed.scheme() != "https" || !(path.ends_with("/configure") || path.ends_with("/configure/")) {
        return false;
    }
    open_with_os(parsed.as_str())
}

#[tauri::command]
pub async fn desktop_browser_capture(
    app: AppHandle,
    window: WebviewWindow,
    ctx: State<'_, AppCtx>,
    opts: Value,
) -> Result<Value, String> {
    if !ensure_main(&window) {
        return Ok(json!({ "ok": false, "error": "Operación no permitida" }));
    }
    Ok(capture::run_browser_capture(app, ctx.core.clone(), opts).await)
}

#[tauri::command]
pub async fn desktop_update(
    app: AppHandle,
    window: WebviewWindow,
    ctx: State<'_, AppCtx>,
    command: String,
) -> Result<Value, String> {
    if !ensure_main(&window) {
        return Ok(Value::Null);
    }
    let res = match command.as_str() {
        "releases" => {
            let url = DesktopUpdater::releases_url();
            Value::Bool(open_with_os(&url))
        }
        "check" => {
            let st = ctx.updater.check(&ctx.core.http).await;
            let _ = window.emit("desktop:update-status", st.clone());
            st
        }
        "download" => {
            let win_emit = window.clone();
            ctx.updater
                .start_download(ctx.core.http.clone(), move |snap| {
                    let _ = win_emit.emit("desktop:update-status", snap);
                })
                .await
        }
        "install" => match ctx.updater.launch_installer().await {
            Ok(st) => {
                let _ = window.emit("desktop:update-status", st.clone());
                let app_exit = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
                    app_exit.exit(0);
                });
                st
            }
            Err(err) => json!({ "state": "error", "error": err }),
        },
        _ => ctx.updater.current().await,
    };
    Ok(res)
}

#[tauri::command]
pub fn desktop_info(window: WebviewWindow, ctx: State<'_, AppCtx>) -> Value {
    if !ensure_main(&window) {
        return Value::Null;
    }
    json!({
        "version": ctx.version,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "independent": true,
        "engine": "rust",
        "runtime": "tauri",
        "nativePlayer": false,
        "proxyPort": ctx.core.bound_port()
    })
}

#[cfg(target_os = "windows")]
fn win_pick_dialog(pick_folder: bool) -> Option<String> {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST,
        FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    unsafe {
        let hr_init = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let should_uninit = hr_init.is_ok();
        let res = (|| -> Option<String> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_ALL).ok()?;
            let mut opts = dialog.GetOptions().ok()?;
            opts |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
            if pick_folder {
                opts |= FOS_PICKFOLDERS;
                let _ = dialog.SetTitle(w!("Seleccionar carpeta de videos"));
            } else {
                opts |= FOS_FILEMUSTEXIST;
                let _ = dialog.SetTitle(w!("Abrir video local"));
                let filters = [
                    COMDLG_FILTERSPEC {
                        pszName: w!("Videos compatibles"),
                        pszSpec: w!("*.mp4;*.mkv;*.avi;*.mov;*.webm;*.m4v;*.ts;*.m2ts;*.flv;*.wmv;*.mpg;*.mpeg"),
                    },
                    COMDLG_FILTERSPEC {
                        pszName: w!("Todos los archivos"),
                        pszSpec: w!("*.*"),
                    },
                ];
                let _ = dialog.SetFileTypes(&filters);
            }
            let _ = dialog.SetOptions(opts);
            dialog.Show(None).ok()?;
            let item = dialog.GetResult().ok()?;
            let pwstr = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let s = pwstr.to_string().ok();
            CoTaskMemFree(Some(pwstr.0 as *const _));
            let _ = PCWSTR::null();
            s
        })();
        if should_uninit {
            CoUninitialize();
        }
        res
    }
}

#[cfg(not(target_os = "windows"))]
fn win_pick_dialog(_pick_folder: bool) -> Option<String> {
    None
}

#[tauri::command]
pub async fn desktop_pick_local_video(window: WebviewWindow) -> Option<String> {
    if !ensure_main(&window) {
        return None;
    }
    tokio::task::spawn_blocking(|| win_pick_dialog(false))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn desktop_pick_local_folder(window: WebviewWindow) -> Option<String> {
    if !ensure_main(&window) {
        return None;
    }
    tokio::task::spawn_blocking(|| win_pick_dialog(true))
        .await
        .ok()
        .flatten()
}
