use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use ed25519_dalek::{Signature, VerifyingKey};
use opentv_core::app_update::{
    compare_versions, find_checksum_asset_url, is_trusted_release_url, parse_sha256sums,
    sha256_file,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const REPO: &str = "EdgarLeonArchuleta19/OpenTV";

/// Owner's Ed25519 release public key (raw 32 bytes, base64). `SHA256SUMS.sig` must be a
/// signature by this key over the exact bytes of `SHA256SUMS` (`scripts/sign-release.cjs`).
const RELEASE_PUBLIC_KEY_B64: &str = include_str!("../../../../scripts/release-public-key.txt");

const UNSIGNED_UPDATE: &str =
    "La actualización no está firmada por TECHPOINT; se canceló por seguridad.";

const MAX_SUMS_BYTES: usize = 256 * 1024;

/// Verifies `sig_text` (base64 Ed25519 signature) over `data` with `public_key_b64`.
pub fn verify_release_signature(
    data: &[u8],
    sig_text: &str,
    public_key_b64: &str,
) -> Result<(), String> {
    let pk: [u8; 32] = B64
        .decode(public_key_b64.trim())
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| UNSIGNED_UPDATE.to_string())?;
    let key = VerifyingKey::from_bytes(&pk).map_err(|_| UNSIGNED_UPDATE.to_string())?;
    let sig: [u8; 64] = B64
        .decode(sig_text.trim())
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| UNSIGNED_UPDATE.to_string())?;
    key.verify_strict(data, &Signature::from_bytes(&sig))
        .map_err(|_| UNSIGNED_UPDATE.to_string())
}

/// URL of `SHA256SUMS.sig` (or `SHA256SUMS.txt.sig`) published on the same release.
fn find_signature_asset_url(assets: Option<&Vec<Value>>) -> Option<String> {
    for a in assets? {
        let name = a["name"].as_str().unwrap_or("").to_ascii_lowercase();
        let url = a["browser_download_url"].as_str().unwrap_or("");
        if (name == "sha256sums.sig" || name == "sha256sums.txt.sig") && is_trusted_release_url(url) {
            return Some(url.to_string());
        }
    }
    None
}

async fn fetch_release_bytes(http: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    if !is_trusted_release_url(url) {
        return Err(UNSIGNED_UPDATE.to_string());
    }
    let resp = http
        .get(url)
        .header("User-Agent", "OpenTV")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| "Sin conexión con el servidor de actualizaciones".to_string())?;
    if !resp.status().is_success() {
        return Err(UNSIGNED_UPDATE.to_string());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|_| "No se pudo leer la información de actualización".to_string())?;
    if bytes.len() > MAX_SUMS_BYTES {
        return Err(UNSIGNED_UPDATE.to_string());
    }
    Ok(bytes.to_vec())
}

/// Downloads `SHA256SUMS` and `SHA256SUMS.sig`, verifies the signature with the embedded
/// release key and only then returns the checksum listed for `asset_name`.
async fn fetch_signed_sha256(
    http: &reqwest::Client,
    assets: Option<&Vec<Value>>,
    asset_name: &str,
) -> Result<String, String> {
    let sums_url = find_checksum_asset_url(assets).ok_or_else(|| UNSIGNED_UPDATE.to_string())?;
    let sig_url = find_signature_asset_url(assets).ok_or_else(|| UNSIGNED_UPDATE.to_string())?;
    let sums = fetch_release_bytes(http, &sums_url).await?;
    let sig = fetch_release_bytes(http, &sig_url).await?;
    let sig_text = String::from_utf8(sig).map_err(|_| UNSIGNED_UPDATE.to_string())?;
    verify_release_signature(&sums, &sig_text, RELEASE_PUBLIC_KEY_B64)?;
    let text = String::from_utf8(sums).map_err(|_| UNSIGNED_UPDATE.to_string())?;
    parse_sha256sums(&text, asset_name)
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|h| valid_sha256(h))
        .ok_or_else(|| "La actualización no incluye una firma SHA-256 válida".to_string())
}

/// Opens the installer so nobody else can write, rename or delete it while it is hashed
/// and started (closes the check-then-run window), and returns its SHA-256.
#[cfg(target_os = "windows")]
fn open_locked_and_hash(path: &std::path::Path) -> Result<(fs::File, String), String> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x1;
    let file = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .map_err(|e| format!("No se pudo abrir el instalador: {e}"))?;
    let hash = opentv_core::app_update::sha256_reader(&file)?;
    Ok((file, hash))
}

#[cfg(not(target_os = "windows"))]
fn open_locked_and_hash(path: &std::path::Path) -> Result<(fs::File, String), String> {
    let file = fs::File::open(path).map_err(|e| format!("No se pudo abrir el instalador: {e}"))?;
    let hash = sha256_file(path)?;
    Ok((file, hash))
}


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
                    let (sha256, sign_error) = if newer && !asset_name.is_empty() {
                        match fetch_signed_sha256(http, data["assets"].as_array(), &asset_name)
                            .await
                        {
                            Ok(h) => (h, String::new()),
                            Err(e) => (String::new(), e),
                        }
                    } else {
                        (String::new(), UNSIGNED_UPDATE.to_string())
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
                        g.error = sign_error;
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
        let (path, expected) = {
            let g = self.inner.lock().await;
            let p = g
                .installer_path
                .clone()
                .filter(|p| p.is_file())
                .ok_or_else(|| "La actualización aún no está descargada".to_string())?;
            (p, g.expected_sha256.trim().to_ascii_lowercase())
        };
        if !valid_sha256(&expected) {
            return Err(UNSIGNED_UPDATE.to_string());
        }

        // Re-hash right before running it, holding a handle that denies writers, so the
        // file that was verified is the file that starts.
        let path_c = path.clone();
        let launched = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let (guard, actual) = open_locked_and_hash(&path_c)?;
            if actual != expected {
                drop(guard);
                let _ = fs::remove_file(&path_c);
                return Err(
                    "La verificación SHA-256 del instalador falló; se descartó por seguridad"
                        .to_string(),
                );
            }
            let res = Command::new(&path_c)
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("No se pudo iniciar el instalador: {e}"));
            drop(guard);
            res
        })
        .await
        .map_err(|_| "No se pudo iniciar el instalador".to_string())?;

        let mut g = self.inner.lock().await;
        match launched {
            Ok(()) => {
                g.state = "installing".to_string();
                drop(g);
                Ok(self.current().await)
            }
            Err(e) => {
                g.state = if g.mandatory { "available" } else { "error" }.to_string();
                g.error = e.clone();
                Err(e)
            }
        }
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

    fn test_keypair() -> (ed25519_dalek::SigningKey, String) {
        let sk = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]);
        let pk = B64.encode(sk.verifying_key().to_bytes());
        (sk, pk)
    }

    #[test]
    fn verifies_signed_checksums_and_rejects_tampering() {
        use ed25519_dalek::Signer;
        let (sk, pk) = test_keypair();
        let sums = b"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  OpenTV-Setup-2.0.1.exe\n";
        let sig = B64.encode(sk.sign(sums).to_bytes());
        assert!(verify_release_signature(sums, &format!("{sig}\n"), &pk).is_ok());

        // Tampered checksum list.
        let mut tampered = sums.to_vec();
        tampered[0] = b'f';
        assert_eq!(
            verify_release_signature(&tampered, &sig, &pk).unwrap_err(),
            UNSIGNED_UPDATE
        );
        // Missing / garbage / wrong-key signatures.
        assert!(verify_release_signature(sums, "", &pk).is_err());
        assert!(verify_release_signature(sums, "bm90LWEtc2lnbmF0dXJl", &pk).is_err());
        let other = ed25519_dalek::SigningKey::from_bytes(&[9u8; 32]);
        let other_sig = B64.encode(other.sign(sums).to_bytes());
        assert!(verify_release_signature(sums, &other_sig, &pk).is_err());
    }

    #[test]
    fn embedded_release_key_is_a_valid_ed25519_key() {
        let raw = B64.decode(RELEASE_PUBLIC_KEY_B64.trim()).expect("base64");
        let arr: [u8; 32] = raw.try_into().expect("32 bytes");
        assert!(VerifyingKey::from_bytes(&arr).is_ok());
    }

    #[test]
    fn signature_asset_must_come_from_github() {
        let assets = vec![
            json!({"name": "SHA256SUMS.sig", "browser_download_url": "https://evil.example/SHA256SUMS.sig"}),
        ];
        assert!(find_signature_asset_url(Some(&assets)).is_none());
        let assets = vec![
            json!({"name": "SHA256SUMS.sig", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.1/SHA256SUMS.sig"}),
        ];
        assert!(find_signature_asset_url(Some(&assets)).is_some());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn locked_installer_can_still_be_started_but_not_modified() {
        let src = std::path::PathBuf::from(r"C:\Windows\System32\whoami.exe");
        if !src.is_file() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("opentv-upd-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let exe = dir.join("setup-test.exe");
        fs::copy(&src, &exe).unwrap();
        let (guard, hash) = open_locked_and_hash(&exe).unwrap();
        assert_eq!(hash, sha256_file(&exe).unwrap());
        assert!(fs::OpenOptions::new().write(true).open(&exe).is_err());
        let status = Command::new(&exe)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        drop(guard);
        let _ = fs::remove_dir_all(&dir);
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
