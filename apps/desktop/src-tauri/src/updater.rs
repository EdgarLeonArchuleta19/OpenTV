use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use opentv_core::app_update::{
    compare_versions, fetch_expected_sha256, find_checksum_asset_url, is_trusted_release_url,
    sha256_file,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const REPO: &str = "EdgarLeonArchuleta19/OpenTV";

/// A release is installable only when GitHub published a real 64-hex SHA-256.
fn valid_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UpdateLock {
    min_version: String,
    notes: String,
    download_url: String,
    html_url: String,
    size: u64,
    #[serde(default)]
    sha256: String,
}

struct UpdaterInner {
    state: String, // "idle" | "up-to-date" | "available" | "downloading" | "ready" | "installing" | "error"
    available: Option<String>,
    mandatory: bool,
    notes: String,
    html_url: String,
    download_url: String,
    expected_sha256: String,
    total: u64,
    error: String,
    installer_path: Option<PathBuf>,
}

#[derive(Clone)]
pub struct DesktopUpdater {
    current_version: String,
    update_dir: PathBuf,
    lock_file: PathBuf,
    bytes: Arc<AtomicU64>,
    inner: Arc<Mutex<UpdaterInner>>,
}

impl DesktopUpdater {
    pub fn new(current_version: String, user_data_dir: PathBuf) -> Self {
        let update_dir = user_data_dir.join("update");
        let lock_file = user_data_dir.join("update-lock.json");

        // Restore persisted mandatory update lock if a newer version was already seen.
        let mut init = UpdaterInner {
            state: "idle".to_string(),
            available: None,
            mandatory: false,
            notes: String::new(),
            html_url: Self::releases_url(),
            download_url: String::new(),
            expected_sha256: String::new(),
            total: 0,
            error: String::new(),
            installer_path: None,
        };

        if let Ok(raw) = fs::read_to_string(&lock_file) {
            if let Ok(lock) = serde_json::from_str::<UpdateLock>(&raw) {
                let checksum = lock.sha256.trim().to_ascii_lowercase();
                if compare_versions(&lock.min_version, &current_version) > 0
                    && valid_sha256(&checksum)
                {
                    init.state = "available".to_string();
                    init.available = Some(lock.min_version);
                    init.mandatory = true;
                    init.notes = lock.notes;
                    init.download_url = lock.download_url;
                    init.expected_sha256 = checksum;
                    init.html_url = if lock.html_url.is_empty() {
                        Self::releases_url()
                    } else {
                        lock.html_url
                    };
                    init.total = lock.size;
                } else {
                    // Already upgraded, or an unverifiable lock: never restore it.
                    let _ = fs::remove_file(&lock_file);
                }
            }
        }

        Self {
            current_version,
            update_dir,
            lock_file,
            bytes: Arc::new(AtomicU64::new(0)),
            inner: Arc::new(Mutex::new(init)),
        }
    }

    pub fn releases_url() -> String {
        format!("https://github.com/{REPO}/releases/latest")
    }

    pub async fn current(&self) -> Value {
        let mut g = self.inner.lock().await;
        if g.state == "ready"
            && !g
                .installer_path
                .as_ref()
                .map(|p| p.is_file())
                .unwrap_or(false)
        {
            g.state = if g.mandatory {
                "available".to_string()
            } else {
                "idle".to_string()
            };
        }
        let bytes = self.bytes.load(Ordering::Relaxed);
        let pct = if g.total > 0 {
            ((bytes.saturating_mul(100)) / g.total).min(100)
        } else {
            0
        };
        json!({
            "state": g.state,
            "version": self.current_version,
            "available": g.available,
            "mandatory": g.mandatory,
            "notes": g.notes,
            "url": g.html_url,
            "downloadUrl": g.download_url,
            "bytes": bytes,
            "total": g.total,
            "progress": pct,
            "error": g.error,
        })
    }

    fn persist_lock(&self, lock: &UpdateLock) {
        if let Some(parent) = self.lock_file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(lock) {
            let tmp = self.lock_file.with_extension("json.tmp");
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, &self.lock_file);
            }
        }
    }

    pub async fn check(&self, http: &reqwest::Client) -> Value {
        let api = format!("https://api.github.com/repos/{REPO}/releases/latest");
        let resp = http
            .get(&api)
            .header("User-Agent", format!("OpenTV/{}", self.current_version))
            .header("Accept", "application/vnd.github+json")
            .timeout(Duration::from_secs(15))
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(data) => {
                    let tag = data["tag_name"]
                        .as_str()
                        .unwrap_or("")
                        .trim_start_matches(['v', 'V'])
                        .trim()
                        .to_string();
                    let html_url = data["html_url"]
                        .as_str()
                        .unwrap_or(&Self::releases_url())
                        .to_string();
                    let notes: String = data["body"]
                        .as_str()
                        .unwrap_or("")
                        .chars()
                        .take(800)
                        .collect();
                    let asset = pick_windows_asset(data["assets"].as_array());
                    let asset_name = asset
                        .as_ref()
                        .and_then(|a| a["name"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let download_url = asset
                        .as_ref()
                        .and_then(|a| a["browser_download_url"].as_str())
                        .filter(|u| is_trusted_release_url(u))
                        .unwrap_or("")
                        .to_string();
                    let size = asset
                        .as_ref()
                        .and_then(|a| a["size"].as_u64())
                        .unwrap_or(0);
                    let newer = !tag.is_empty() && compare_versions(&tag, &self.current_version) > 0;
                    let sha256 = if newer && !asset_name.is_empty() {
                        if let Some(cs_url) = find_checksum_asset_url(data["assets"].as_array()) {
                            fetch_expected_sha256(http, &cs_url, &asset_name)
                                .await
                                .unwrap_or_default()
                                .trim()
                                .to_ascii_lowercase()
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };
                    let verifiable = valid_sha256(&sha256);

                    let mut g = self.inner.lock().await;
                    if newer && verifiable {
                        g.available = Some(tag.clone());
                        g.mandatory = true;
                        g.notes = notes.clone();
                        g.html_url = html_url.clone();
                        g.download_url = download_url.clone();
                        g.expected_sha256 = sha256.clone();
                        g.total = size;
                        g.error.clear();
                        if g.state != "downloading" && g.state != "ready" {
                            g.state = "available".to_string();
                        }
                        self.persist_lock(&UpdateLock {
                            min_version: tag,
                            notes,
                            download_url,
                            html_url,
                            size,
                            sha256,
                        });
                    } else if newer {
                        // Fail closed: an unsigned release is never offered or locked.
                        g.error =
                            "La actualización no incluye una firma SHA-256 válida".to_string();
                        if !g.mandatory {
                            g.state = "error".to_string();
                        }
                    } else if !g.mandatory {
                        g.state = "up-to-date".to_string();
                        g.available = None;
                        g.html_url = html_url;
                        g.error.clear();
                    }
                }
                Err(_) => {
                    let mut g = self.inner.lock().await;
                    if !g.mandatory {
                        g.state = "error".to_string();
                    }
                    g.error = "No se pudo leer la información de actualización".to_string();
                }
            },
            _ => {
                let mut g = self.inner.lock().await;
                if !g.mandatory {
                    g.state = "error".to_string();
                }
                g.error = "Sin conexión con el servidor de actualizaciones".to_string();
            }
        }

        self.current().await
    }

    pub async fn start_download<F>(&self, http: reqwest::Client, on_progress: F) -> Value
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        // Refresh metadata if download URL is missing.
        {
            let needs_check = {
                let g = self.inner.lock().await;
                g.download_url.is_empty()
            };
            if needs_check {
                let _ = self.check(&http).await;
            }
        }

        let (url, ver, expected_size, expected_sha256) = {
            let mut g = self.inner.lock().await;
            if g.state == "downloading" {
                drop(g);
                return self.current().await;
            }
            if !is_trusted_release_url(&g.download_url) {
                g.error = "No se encontró el instalador de Windows en este lanzamiento".to_string();
                drop(g);
                return self.current().await;
            }
            let expected_hash = g.expected_sha256.trim().to_ascii_lowercase();
            if !valid_sha256(&expected_hash) {
                g.error = "La actualización no incluye una firma SHA-256 válida".to_string();
                drop(g);
                return self.current().await;
            }
            let ver = g.available.clone().unwrap_or_else(|| "nueva".to_string());
            let safe_ver: String = ver
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
                .collect();
            let file_name = format!(
                "OpenTV-Setup-{}.exe",
                if safe_ver.is_empty() { "nueva" } else { &safe_ver }
            );
            let _ = fs::create_dir_all(&self.update_dir);
            let target = self.update_dir.join(file_name);
            let expected = g.total;
            g.installer_path = Some(target.clone());
            g.error.clear();

            if target.is_file() {
                let len = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                let size_ok = len > 100_000 && (expected == 0 || len == expected);
                let hash_ok = sha256_file(&target)
                    .map(|h| h == expected_hash)
                    .unwrap_or(false);
                if size_ok && hash_ok {
                    g.state = "ready".to_string();
                    g.total = len;
                    self.bytes.store(len, Ordering::Relaxed);
                    drop(g);
                    let snap = self.current().await;
                    on_progress(snap.clone());
                    return snap;
                }
                let _ = fs::remove_file(&target);
            }

            g.state = "downloading".to_string();
            self.bytes.store(0, Ordering::Relaxed);
            (g.download_url.clone(), ver, expected, expected_hash)
        };

        let me = self.clone();
        let cb = Arc::new(on_progress);
        let initial = self.current().await;
        cb(initial.clone());

        tokio::spawn(async move {
            let target = {
                let g = me.inner.lock().await;
                g.installer_path
                    .clone()
                    .unwrap_or_else(|| me.update_dir.join(format!("OpenTV-Setup-{ver}.exe")))
            };
            let part = target.with_extension("exe.part");

            let res: Result<u64, String> = async {
                let mut resp = http
                    .get(&url)
                    .header("User-Agent", format!("OpenTV/{}", me.current_version))
                    .timeout(Duration::from_secs(600))
                    .send()
                    .await
                    .map_err(|e| format!("Error de red: {e}"))?;
                if !resp.status().is_success() {
                    return Err(format!("El servidor respondió {}", resp.status().as_u16()));
                }
                if let Some(cl) = resp.content_length() {
                    me.inner.lock().await.total = cl;
                }
                let mut file = tokio::fs::File::create(&part)
                    .await
                    .map_err(|e| format!("No se pudo escribir el archivo: {e}"))?;
                let mut written = 0u64;
                let mut last_emit = std::time::Instant::now();

                while let Some(chunk) = resp
                    .chunk()
                    .await
                    .map_err(|e| format!("Descarga interrumpida: {e}"))?
                {
                    file.write_all(&chunk)
                        .await
                        .map_err(|e| format!("Error al guardar: {e}"))?;
                    written = written.saturating_add(chunk.len() as u64);
                    me.bytes.store(written, Ordering::Relaxed);
                    if last_emit.elapsed() >= Duration::from_millis(250) {
                        last_emit = std::time::Instant::now();
                        cb(me.current().await);
                    }
                }
                file.flush()
                    .await
                    .map_err(|e| format!("Error al cerrar archivo: {e}"))?;
                drop(file);

                if expected_size > 0 && written != expected_size {
                    let _ = tokio::fs::remove_file(&part).await;
                    return Err("La descarga quedó incompleta".to_string());
                }
                if written < 100_000 {
                    let _ = tokio::fs::remove_file(&part).await;
                    return Err("El instalador descargado no es válido".to_string());
                }
                let part_clone = part.clone();
                let actual = tokio::task::spawn_blocking(move || sha256_file(&part_clone))
                    .await
                    .map_err(|_| "Error verificando integridad".to_string())??;
                if actual != expected_sha256 {
                    let _ = tokio::fs::remove_file(&part).await;
                    return Err("La verificación SHA-256 del instalador falló; se descartó por seguridad".to_string());
                }
                let _ = tokio::fs::remove_file(&target).await;
                tokio::fs::rename(&part, &target)
                    .await
                    .map_err(|e| format!("No se pudo finalizar el instalador: {e}"))?;
                Ok(written)
            }
            .await;

            {
                let mut g = me.inner.lock().await;
                match res {
                    Ok(size) => {
                        g.state = "ready".to_string();
                        g.total = size;
                        g.error.clear();
                        me.bytes.store(size, Ordering::Relaxed);
                    }
                    Err(msg) => {
                        g.state = if g.mandatory {
                            "available".to_string()
                        } else {
                            "error".to_string()
                        };
                        g.error = msg;
                    }
                }
            }
            cb(me.current().await);
        });

        initial
    }

    pub async fn launch_installer(&self) -> Result<Value, String> {
        let path = {
            let mut g = self.inner.lock().await;
            let p = g
                .installer_path
                .clone()
                .filter(|p| p.is_file())
                .ok_or_else(|| "La actualización aún no está descargada".to_string())?;
            g.state = "installing".to_string();
            p
        };

        Command::new(&path)
            .spawn()
            .map_err(|e| format!("No se pudo iniciar el instalador: {e}"))?;
        Ok(self.current().await)
    }
}

pub fn pick_windows_asset(assets: Option<&Vec<Value>>) -> Option<Value> {
    let assets = assets?;
    let mut preferred: Option<Value> = None;
    let mut fallback: Option<Value> = None;
    for a in assets {
        let name = a["name"].as_str().unwrap_or("").to_ascii_lowercase();
        let url = a["browser_download_url"].as_str().unwrap_or("");
        if !name.ends_with(".exe") || !is_trusted_release_url(url) {
            continue;
        }
        if name.contains("setup") || name.contains("x64") {
            if preferred.is_none() {
                preferred = Some(a.clone());
            }
        } else if fallback.is_none() {
            fallback = Some(a.clone());
        }
    }
    preferred.or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentv_core::app_update::compare_versions;

    #[test]
    fn compares_semver_and_prereleases_correctly() {
        assert!(compare_versions("2.0.0", "2.0.0-alpha.1") > 0);
        assert!(compare_versions("2.0.0-alpha.2", "2.0.0-alpha.1") > 0);
        assert!(compare_versions("2.0.0-beta.1", "2.0.0-alpha.1") > 0);
        assert!(compare_versions("2.0.0-alpha.1", "2.0.0") < 0);
        assert_eq!(compare_versions("2.0.0", "2.0.0"), 0);
        assert!(compare_versions("2.0.1", "2.0.0") > 0);
    }

    #[test]
    fn refuses_installers_without_a_valid_checksum() {
        assert!(valid_sha256(&"a".repeat(64)));
        assert!(!valid_sha256(""));
        assert!(!valid_sha256(&"g".repeat(64)));
        assert!(!valid_sha256(&"a".repeat(63)));
    }

    #[test]
    fn picks_windows_setup_exe_from_release_assets() {
        let assets = vec![
            json!({"name": "OpenTV-2.0.0.apk", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-2.0.0.apk"}),
            json!({"name": "OpenTV-Setup-2.0.0.exe", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-Setup-2.0.0.exe"}),
        ];
        assert_eq!(
            pick_windows_asset(Some(&assets)).unwrap()["name"],
            "OpenTV-Setup-2.0.0.exe"
        );
    }
}
