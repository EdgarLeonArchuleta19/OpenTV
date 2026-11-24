use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

const GITHUB_API: &str =
    "https://api.github.com/repos/EdgarLeonArchuleta19/OpenTV/releases/latest";
const CHECK_TTL: Duration = Duration::from_secs(6 * 60 * 60);

pub type InstallCallback = Arc<dyn Fn(&str) -> Value + Send + Sync>;

struct Inner {
    last_check: Option<(Instant, Value)>,
    state: String,
    total: u64,
    error: String,
    apk_path: Option<PathBuf>,
}

#[derive(Clone)]
pub struct AppUpdater {
    http: reqwest::Client,
    cache_dir: PathBuf,
    current_version: String,
    abi: String,
    bytes: Arc<AtomicU64>,
    inner: Arc<Mutex<Inner>>,
    installer: Option<InstallCallback>,
}

impl AppUpdater {
    pub fn new(
        http: reqwest::Client,
        cache_root: PathBuf,
        current_version: String,
        abi: String,
        installer: Option<InstallCallback>,
    ) -> Self {
        Self {
            http,
            cache_dir: cache_root.join("update"),
            current_version,
            abi,
            bytes: Arc::new(AtomicU64::new(0)),
            inner: Arc::new(Mutex::new(Inner {
                last_check: None,
                state: "idle".to_string(),
                total: 0,
                error: String::new(),
                apk_path: None,
            })),
            installer,
        }
    }

    pub async fn handle(&self, p: &Value) -> Result<Value, String> {
        let action = p["action"].as_str().unwrap_or("check");
        match action {
            "check" => self.check(p["force"].as_bool().unwrap_or(false)).await,
            "download" => self.download().await,
            "status" => Ok(self.status().await),
            "install" => self.install().await,
            _ => Err("Acción desconocida".to_string()),
        }
    }

    async fn check(&self, force: bool) -> Result<Value, String> {
        {
            let guard = self.inner.lock().await;
            if !force {
                if let Some((at, ref val)) = guard.last_check {
                    if at.elapsed() < CHECK_TTL {
                        return Ok(val.clone());
                    }
                }
            }
        }

        let resp = self
            .http
            .get(GITHUB_API)
            .header(reqwest::header::USER_AGENT, "OpenTV")
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|_| "No se pudo buscar actualizaciones".to_string())?;
        if !resp.status().is_success() {
            return Err("No se pudo buscar actualizaciones".to_string());
        }
        let release: Value = resp
            .json()
            .await
            .map_err(|_| "No se pudo buscar actualizaciones".to_string())?;

        let latest = release["tag_name"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches(['v', 'V'])
            .trim()
            .to_string();
        let html_url = release["html_url"]
            .as_str()
            .unwrap_or("https://github.com/EdgarLeonArchuleta19/OpenTV/releases/latest")
            .to_string();
        let asset = pick_asset(release["assets"].as_array(), &self.abi);
        let asset_name = asset
            .as_ref()
            .and_then(|a| a["name"].as_str())
            .unwrap_or("")
            .to_string();
        let checksum_url = find_checksum_asset_url(release["assets"].as_array());
        let expected_sha256 = if let (Some(cs_url), false) = (checksum_url, asset_name.is_empty()) {
            fetch_expected_sha256(&self.http, &cs_url, &asset_name).await
        } else {
            None
        };
        let notes: String = release["body"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(600)
            .collect();
        let is_newer = !latest.is_empty() && compare_versions(&latest, &self.current_version) > 0;
        let download_url = asset
            .as_ref()
            .and_then(|a| a["browser_download_url"].as_str())
            .filter(|u| is_trusted_release_url(u))
            .unwrap_or("");
        // Fail closed: never offer an update whose binary cannot be verified.
        let available = is_newer && !download_url.is_empty() && expected_sha256.is_some();
        let out = json!({
            "current": self.current_version,
            "latest": latest,
            "available": available,
            "mandatory": is_newer,
            "notes": notes,
            "size": asset.as_ref().and_then(|a| a["size"].as_u64()).unwrap_or(0),
            "url": download_url,
            "sha256": expected_sha256.unwrap_or_default(),
            "htmlUrl": html_url
        });

        let mut guard = self.inner.lock().await;
        guard.last_check = Some((Instant::now(), out.clone()));
        Ok(out)
    }

    async fn download(&self) -> Result<Value, String> {
        let info = self.check(false).await?;
        if !info["available"].as_bool().unwrap_or(false) {
            return Err("Ya tienes la versión más reciente".to_string());
        }
        let latest = info["latest"].as_str().unwrap_or("nueva");
        let url = info["url"].as_str().unwrap_or("").to_string();
        let expected_size = info["size"].as_u64().unwrap_or(0);
        let expected_sha256 = info["sha256"].as_str().unwrap_or("").trim().to_ascii_lowercase();
        if expected_sha256.len() != 64 || !expected_sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("La actualización no incluye una firma SHA-256 válida".to_string());
        }

        let safe_ver: String = latest
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
            .collect();
        let file_name = format!(
            "OpenTV-{}.apk",
            if safe_ver.is_empty() { "nueva" } else { &safe_ver }
        );
        let _ = tokio::fs::create_dir_all(&self.cache_dir).await;
        let target = self.cache_dir.join(file_name);

        {
            let mut guard = self.inner.lock().await;
            if guard.state == "downloading" {
                return Ok(json!({ "state": "downloading" }));
            }
            guard.apk_path = Some(target.clone());
            guard.total = expected_size;
            guard.error.clear();
            if target.is_file() {
                let len = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                let size_ok = expected_size == 0 || len == expected_size;
                let hash_ok = sha256_file(&target)
                    .map(|h| h == expected_sha256)
                    .unwrap_or(false);
                if size_ok && hash_ok {
                    guard.state = "ready".to_string();
                    self.bytes.store(len, Ordering::Relaxed);
                    return Ok(json!({ "state": "ready" }));
                }
                let _ = std::fs::remove_file(&target);
            }
            guard.state = "downloading".to_string();
            self.bytes.store(0, Ordering::Relaxed);
        }

        let me = self.clone();
        tokio::spawn(async move {
            let part = target.with_extension("apk.part");
            let res: Result<u64, String> = async {
                let resp = me
                    .http
                    .get(&url)
                    .header(reqwest::header::USER_AGENT, "OpenTV")
                    .timeout(Duration::from_secs(300))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    return Err(format!("respuesta {}", resp.status().as_u16()));
                }
                if let Some(cl) = resp.content_length() {
                    me.inner.lock().await.total = cl;
                }
                let mut f = tokio::fs::File::create(&part)
                    .await
                    .map_err(|e| e.to_string())?;
                let mut hasher = Sha256::new();
                let mut written = 0u64;
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let b = chunk.map_err(|e| e.to_string())?;
                    hasher.update(&b);
                    f.write_all(&b).await.map_err(|e| e.to_string())?;
                    written = written.saturating_add(b.len() as u64);
                    me.bytes.store(written, Ordering::Relaxed);
                }
                f.flush().await.map_err(|e| e.to_string())?;
                drop(f);
                if expected_size > 0 && written != expected_size {
                    let _ = tokio::fs::remove_file(&part).await;
                    return Err("descarga incompleta".to_string());
                }
                let actual = format!("{:x}", hasher.finalize());
                if actual != expected_sha256 {
                    let _ = tokio::fs::remove_file(&part).await;
                    return Err("La verificación criptográfica SHA-256 falló".to_string());
                }
                let _ = tokio::fs::remove_file(&target).await;
                tokio::fs::rename(&part, &target)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(written)
            }
            .await;

            let mut guard = me.inner.lock().await;
            match res {
                Ok(size) => {
                    guard.state = "ready".to_string();
                    guard.total = size;
                    me.bytes.store(size, Ordering::Relaxed);
                }
                Err(_) => {
                    guard.state = "error".to_string();
                    guard.error =
                        "No se pudo descargar la actualización. Vuelve a intentarlo.".to_string();
                }
            }
        });

        Ok(json!({ "state": "downloading" }))
    }

    async fn status(&self) -> Value {
        let mut guard = self.inner.lock().await;
        if guard.state == "ready"
            && !guard
                .apk_path
                .as_ref()
                .map(|p| p.is_file())
                .unwrap_or(false)
        {
            guard.state = "idle".to_string();
        }
        json!({
            "state": guard.state,
            "bytes": self.bytes.load(Ordering::Relaxed),
            "total": guard.total,
            "error": guard.error
        })
    }

    async fn install(&self) -> Result<Value, String> {
        let path = {
            let guard = self.inner.lock().await;
            if guard.state != "ready" {
                return Err("La actualización aún no está descargada".to_string());
            }
            guard
                .apk_path
                .clone()
                .filter(|p| p.is_file())
                .ok_or_else(|| "La actualización aún no está descargada".to_string())?
        };
        let Some(ref cb) = self.installer else {
            return Err("Instalación de APK solo disponible en Android".to_string());
        };
        Ok(cb(&path.to_string_lossy()))
    }
}

pub fn find_checksum_asset_url(assets: Option<&Vec<Value>>) -> Option<String> {
    let assets = assets?;
    for a in assets {
        let name = a["name"].as_str().unwrap_or("").to_ascii_lowercase();
        let url = a["browser_download_url"].as_str().unwrap_or("");
        if (name == "sha256sums.txt" || name == "sha256sums") && is_trusted_release_url(url) {
            return Some(url.to_string());
        }
    }
    None
}

/// Parses GNU `sha256sum` lines (`<64-hex>  <filename>`) and returns the lowercase SHA-256 for [filename].
pub fn parse_sha256sums(content: &str, filename: &str) -> Option<String> {
    let want = filename.trim().to_ascii_lowercase();
    if want.is_empty() {
        return None;
    }
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let hex = parts.next()?.trim().to_ascii_lowercase();
        let rest = parts.next()?.trim().trim_start_matches('*');
        if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            let base = rest
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(rest)
                .to_ascii_lowercase();
            if base == want {
                return Some(hex);
            }
        }
    }
    None
}

pub async fn fetch_expected_sha256(
    http: &reqwest::Client,
    checksum_url: &str,
    filename: &str,
) -> Option<String> {
    if !is_trusted_release_url(checksum_url) {
        return None;
    }
    let resp = http
        .get(checksum_url)
        .header(reqwest::header::USER_AGENT, "OpenTV")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let text = resp.text().await.ok()?;
    parse_sha256sums(&text, filename)
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    sha256_reader(f)
}

/// SHA-256 (lowercase hex) of everything readable from `f`, streamed in 64 KB chunks.
/// Lets callers hash through a handle they already hold (e.g. one that denies writers).
pub fn sha256_reader<R: Read>(mut f: R) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn is_trusted_release_url(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else {
        return false;
    };
    if u.scheme() != "https" {
        return false;
    }
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    host == "github.com"
        || host.ends_with(".github.com")
        || host == "githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

fn abi_matches_name(abi: &str, lower_name: &str) -> bool {
    let a = abi.to_ascii_lowercase();
    if a.is_empty() {
        return false;
    }
    if lower_name.contains(&a) {
        return true;
    }
    match a.as_str() {
        "armeabi-v7a" => lower_name.contains("armv7"),
        "arm64-v8a" => lower_name.contains("arm64") || lower_name.contains("aarch64"),
        "x86_64" => lower_name.contains("x86_64") || lower_name.contains("-x64"),
        "x86" => lower_name.contains("-x86.") || lower_name.contains("_x86."),
        _ => false,
    }
}

fn has_any_abi_tag(lower_name: &str) -> bool {
    const TAGS: &[&str] = &[
        "armeabi-v7a",
        "armv7",
        "arm64-v8a",
        "arm64",
        "aarch64",
        "x86_64",
        "-x64",
        "-x86.",
        "_x86.",
    ];
    TAGS.iter().any(|t| lower_name.contains(t))
}

fn pick_asset(assets: Option<&Vec<Value>>, abi: &str) -> Option<Value> {
    let assets = assets?;
    let mut mine: Option<Value> = None;
    let mut universal: Option<Value> = None;
    let mut any_apk: Option<Value> = None;
    for a in assets {
        let name = a["name"].as_str().unwrap_or("").to_ascii_lowercase();
        let url = a["browser_download_url"].as_str().unwrap_or("");
        if !name.ends_with(".apk") || !is_trusted_release_url(url) {
            continue;
        }
        if any_apk.is_none() {
            any_apk = Some(a.clone());
        }
        if !has_any_abi_tag(&name) {
            if universal.is_none() {
                universal = Some(a.clone());
            }
            continue;
        }
        if abi_matches_name(abi, &name) && mine.is_none() {
            mine = Some(a.clone());
        }
    }
    mine.or(universal).or(any_apk)
}

fn parse_semver(v: &str) -> ([u64; 3], Option<&str>) {
    let trimmed = v.trim().trim_start_matches(['v', 'V']);
    let (core, pre) = match trimmed.split_once('-') {
        Some((c, p)) => (c, Some(p.split('+').next().unwrap_or(p))),
        None => (trimmed.split('+').next().unwrap_or(trimmed), None),
    };
    let mut parts = [0u64; 3];
    for (i, seg) in core.split('.').take(3).enumerate() {
        parts[i] = seg.parse::<u64>().unwrap_or(0);
    }
    (parts, pre.filter(|p| !p.is_empty()))
}

fn compare_prerelease(a: &str, b: &str) -> i32 {
    let pa: Vec<&str> = a.split('.').collect();
    let pb: Vec<&str> = b.split('.').collect();
    let n = pa.len().max(pb.len());
    for i in 0..n {
        match (pa.get(i), pb.get(i)) {
            (None, None) => return 0,
            (None, Some(_)) => return -1,
            (Some(_), None) => return 1,
            (Some(x), Some(y)) if x == y => continue,
            (Some(x), Some(y)) => {
                return match (x.parse::<u64>(), y.parse::<u64>()) {
                    (Ok(nx), Ok(ny)) => if nx > ny { 1 } else { -1 },
                    (Ok(_), Err(_)) => -1,
                    (Err(_), Ok(_)) => 1,
                    (Err(_), Err(_)) => if x > y { 1 } else { -1 },
                };
            }
        }
    }
    0
}

/// SemVer comparator returning `> 0` when `a` is newer than `b`, `< 0` when older, `0` when equal.
pub fn compare_versions(a: &str, b: &str) -> i32 {
    let (va, pre_a) = parse_semver(a);
    let (vb, pre_b) = parse_semver(b);
    for i in 0..3 {
        if va[i] != vb[i] {
            return if va[i] > vb[i] { 1 } else { -1 };
        }
    }
    match (pre_a, pre_b) {
        (None, None) => 0,
        (None, Some(_)) => 1,  // 2.0.0 > 2.0.0-alpha.1
        (Some(_), None) => -1, // 2.0.0-alpha.1 < 2.0.0
        (Some(pa), Some(pb)) => compare_prerelease(pa, pb),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_handles_stable_and_prereleases() {
        assert!(compare_versions("2.0.0", "2.0.0-alpha.1") > 0);
        assert!(compare_versions("2.0.0-alpha.1", "2.0.0") < 0);
        assert!(compare_versions("2.0.0-alpha.10", "2.0.0-alpha.2") > 0);
        assert!(compare_versions("2.0.0-beta.1", "2.0.0-alpha.9") > 0);
        assert!(compare_versions("2.0.0-alpha.1", "1.9.9") > 0);
        assert_eq!(compare_versions("v2.0.0", "2.0.0"), 0);
    }

    #[test]
    fn picks_matching_android_abi_or_universal() {
        let assets = vec![
            json!({"name": "OpenTV-Setup-2.0.0.exe", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-Setup-2.0.0.exe"}),
            json!({"name": "OpenTV-2.0.0.apk", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-2.0.0.apk"}),
            json!({"name": "OpenTV-2.0.0-firetv-armv7.apk", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-2.0.0-firetv-armv7.apk"}),
            json!({"name": "OpenTV-2.0.0-arm64.apk", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-2.0.0-arm64.apk"}),
        ];
        assert_eq!(
            pick_asset(Some(&assets), "armeabi-v7a").unwrap()["name"],
            "OpenTV-2.0.0-firetv-armv7.apk"
        );
        assert_eq!(
            pick_asset(Some(&assets), "arm64-v8a").unwrap()["name"],
            "OpenTV-2.0.0-arm64.apk"
        );
        assert_eq!(
            pick_asset(Some(&assets), "x86_64").unwrap()["name"],
            "OpenTV-2.0.0.apk"
        );

        // Single universal APK named for Fire TV + Android TV + Android Mobile matches every device ABI
        let single_universal = vec![
            json!({"name": "OpenTV-Setup-2.0.0.exe", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-Setup-2.0.0.exe"}),
            json!({"name": "OpenTV-2.0.0-FireTV-AndroidTV-Mobile.apk", "browser_download_url": "https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v2.0.0/OpenTV-2.0.0-FireTV-AndroidTV-Mobile.apk"}),
        ];
        assert_eq!(
            pick_asset(Some(&single_universal), "armeabi-v7a").unwrap()["name"],
            "OpenTV-2.0.0-FireTV-AndroidTV-Mobile.apk"
        );
        assert_eq!(
            pick_asset(Some(&single_universal), "arm64-v8a").unwrap()["name"],
            "OpenTV-2.0.0-FireTV-AndroidTV-Mobile.apk"
        );
    }

    #[test]
    fn parses_sha256sums_lines_strictly() {
        let sum = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let txt = format!(
            "# OpenTV release checksums\n{sum}  OpenTV-Setup-2.0.0.exe\n0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef *dist/OpenTV-2.0.0-FireTV-AndroidTV-Mobile.apk\n"
        );
        assert_eq!(
            parse_sha256sums(&txt, "OpenTV-Setup-2.0.0.exe").as_deref(),
            Some(sum)
        );
        assert_eq!(
            parse_sha256sums(&txt, "OpenTV-2.0.0-FireTV-AndroidTV-Mobile.apk").as_deref(),
            Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
        );
        assert_eq!(parse_sha256sums(&txt, "other.apk"), None);
    }
}
