use std::path::PathBuf;
use std::sync::Arc;

use crate::app_update::InstallCallback;

pub type DownloadNotifyCallback = Arc<dyn Fn() + Send + Sync>;

/// Runtime configuration shared across Desktop (Electron) and Android (JNI).
#[derive(Clone)]
pub struct ServiceConfig {
    /// Loopback TCP port for RPC + streaming proxy (0 = OS chooses a free port).
    pub port: u16,
    /// Per-session secret required on every RPC call (`X-OpenTV-Token` header or
    /// `__token` query parameter). Electron and Android both generate one; `None`
    /// is only for local development harnesses.
    pub auth_token: Option<String>,
    /// Web origins allowed to talk to the service. A request that carries any
    /// other `Origin` (a website open in a browser on the same device, the
    /// sandboxed plugin iframe whose origin is `null`) is refused on every route.
    /// Requests without `Origin` (native players, Java, Electron main) pass.
    pub allowed_origins: Vec<String>,
    /// Optional path to `config/tmdb.json` (fallback when env vars are unset).
    pub tmdb_config_path: Option<PathBuf>,
    /// Optional inline TMDB credentials JSON (e.g. decrypted in-memory from Android assets).
    pub tmdb_inline_json: Option<String>,
    /// Platform hint (`"desktop"` | `"android"`).
    pub platform: String,
    /// Optional downloads directory (PC: Videos/OpenTV; Android: app downloads).
    pub downloads_dir: Option<PathBuf>,
    /// Optional cache directory (sized images, torrent cache, temporary files).
    pub cache_dir: Option<PathBuf>,
    /// True when running on a constrained 1 GB TV device.
    pub low_memory: bool,
    /// Optional app version string reported in `ping`.
    pub app_version: Option<String>,
    /// Optional Android versionCode reported in `ping`.
    pub version_code: Option<i64>,
    /// Primary CPU ABI on Android (e.g. `arm64-v8a` or `armeabi-v7a`).
    pub abi: Option<String>,
    /// Optional hardware codec/display capabilities JSON (Android `MediaCaps`).
    pub media_caps: Option<serde_json::Value>,
    /// Optional path to `mpv-2.dll` / `libmpv-2.dll` on Desktop.
    pub mpv_dll_path: Option<PathBuf>,
    /// Optional Android hook invoked when `appUpdate({action: 'install'})` triggers.
    pub install_apk_hook: Option<InstallCallback>,
    /// Optional Android hook invoked when a new download starts (foreground service + permission).
    pub download_start_hook: Option<DownloadNotifyCallback>,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            port: 8910,
            auth_token: None,
            allowed_origins: allowed_origins_for(if cfg!(target_os = "android") {
                "android"
            } else {
                "desktop"
            }),
            tmdb_config_path: None,
            tmdb_inline_json: None,
            platform: if cfg!(target_os = "android") {
                "android".to_string()
            } else {
                "desktop".to_string()
            },
            downloads_dir: None,
            cache_dir: None,
            low_memory: cfg!(target_os = "android"),
            app_version: None,
            version_code: None,
            abi: None,
            media_caps: None,
            mpv_dll_path: None,
            install_apk_hook: None,
            download_start_hook: None,
        }
    }
}

/// Generates a cryptographically-random per-session token for launchers that
/// do not supply one, so the loopback service is never left unauthenticated.
pub fn generate_session_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The app's own pages: Electron (`opentv://app`), Tauri v2 (`http://tauri.localhost`
/// / `https://tauri.localhost`), and the legacy Capacitor WebView (`http://localhost`,
/// `https://localhost`, `capacitor://localhost`). Kept for the standalone
/// `opentv-service` harness; embedders should prefer [`allowed_origins_for`].
pub fn default_allowed_origins() -> Vec<String> {
    let mut origins = vec![
        "opentv://app".to_string(),
        "http://tauri.localhost".to_string(),
        "https://tauri.localhost".to_string(),
        "http://localhost".to_string(),
        "https://localhost".to_string(),
        "capacitor://localhost".to_string(),
    ];
    if cfg!(debug_assertions) {
        origins.push("http://localhost:5173".to_string());
        origins.push("http://127.0.0.1:5173".to_string());
    }
    origins
}

/// Origins each shipping platform actually uses.
/// - `desktop` (Tauri v2 on Windows/WebView2): `http(s)://tauri.localhost`, plus the
///   Vite dev server only in debug builds.
/// - `android`: the UI is native Compose and talks to the core through JNI; ExoPlayer,
///   Coil and OkHttp send no `Origin`, so no web origin is trusted at all.
/// - anything else: the legacy list.
pub fn allowed_origins_for(platform: &str) -> Vec<String> {
    match platform {
        "android" => Vec::new(),
        "desktop" => {
            let mut origins = vec![
                "http://tauri.localhost".to_string(),
                "https://tauri.localhost".to_string(),
            ];
            if cfg!(debug_assertions) {
                origins.push("http://localhost:5173".to_string());
                origins.push("http://127.0.0.1:5173".to_string());
            }
            origins
        }
        _ => default_allowed_origins(),
    }
}

impl ServiceConfig {
    pub fn resolved_cache_dir(&self) -> PathBuf {
        if let Some(ref p) = self.cache_dir {
            return p.clone();
        }
        std::env::temp_dir().join("opentv-cache")
    }

    pub fn resolved_downloads_dir(&self) -> PathBuf {
        if let Some(ref p) = self.downloads_dir {
            return p.clone();
        }
        #[cfg(target_os = "windows")]
        if let Ok(profile) = std::env::var("USERPROFILE") {
            return PathBuf::from(profile).join("Videos").join("OpenTV");
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join("Videos").join("OpenTV");
        }
        std::env::temp_dir().join("OpenTV-Downloads")
    }
}
