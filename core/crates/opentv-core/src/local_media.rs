use std::collections::{HashMap, VecDeque};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream;
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::RwLock;

use crate::torrents::{encode_path_segment, mime_for_name, parse_range};

const MAX_REGISTERED_FILES: usize = 128;
const MAX_REGISTERED_SUBS: usize = 256;
const MAX_SCAN_ITEMS: usize = 200;
const MAX_SUBTITLE_BYTES: u64 = 4 * 1024 * 1024;

const VIDEO_EXTS: &[&str] = &[
    "mp4", "m4v", "mkv", "webm", "avi", "mov", "ts", "m2ts", "flv", "wmv", "ogv", "mpg", "mpeg",
    "3gp",
];

const SUB_EXTS: &[&str] = &["srt", "vtt", "ass", "ssa"];

#[derive(Clone)]
pub struct LocalMediaStore {
    files: Arc<RwLock<HashMap<String, PathBuf>>>,
    file_order: Arc<RwLock<VecDeque<String>>>,
    subs: Arc<RwLock<HashMap<String, PathBuf>>>,
    sub_order: Arc<RwLock<VecDeque<String>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedVideoItem {
    pub path: String,
    pub name: String,
    pub title: String,
    pub ext: String,
    pub size: u64,
    pub modified_ms: u64,
    pub folder: String,
}

fn random_token() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    let mut s = String::with_capacity(32);
    for b in buf {
        use std::fmt::Write;
        let _ = write!(&mut s, "{b:02x}");
    }
    s
}

fn ext_lower(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn is_local_video_path(path: &Path) -> bool {
    let ext = ext_lower(path);
    VIDEO_EXTS.contains(&ext.as_str())
}

pub fn is_local_subtitle_path(path: &Path) -> bool {
    let ext = ext_lower(path);
    SUB_EXTS.contains(&ext.as_str())
}

fn clean_title_from_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Video local");
    let replaced = stem.replace(['.', '_'], " ");
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        "Video local".to_string()
    } else {
        collapsed
    }
}

fn infer_sub_lang(file_name: &str) -> &'static str {
    let low = file_name.to_ascii_lowercase();
    if low.contains(".es.")
        || low.contains(".spa.")
        || low.contains("espanol")
        || low.contains("español")
        || low.contains("latino")
        || low.contains("castellano")
    {
        "es"
    } else if low.contains(".en.") || low.contains(".eng.") || low.contains("english") {
        "en"
    } else if low.contains(".pt.") || low.contains(".por.") || low.contains("portug") {
        "pt"
    } else if low.contains(".fr.") || low.contains(".fre.") {
        "fr"
    } else if low.contains(".de.") || low.contains(".ger.") {
        "de"
    } else if low.contains(".it.") || low.contains(".ita.") {
        "it"
    } else if low.contains(".ja.") || low.contains(".jpn.") {
        "ja"
    } else {
        "es"
    }
}

impl Default for LocalMediaStore {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalMediaStore {
    pub fn new() -> Self {
        Self {
            files: Arc::new(RwLock::new(HashMap::new())),
            file_order: Arc::new(RwLock::new(VecDeque::new())),
            subs: Arc::new(RwLock::new(HashMap::new())),
            sub_order: Arc::new(RwLock::new(VecDeque::new())),
        }
    }

    async fn insert_file(&self, path: PathBuf) -> String {
        let token = random_token();
        let mut map = self.files.write().await;
        let mut order = self.file_order.write().await;
        map.insert(token.clone(), path);
        order.push_back(token.clone());
        while order.len() > MAX_REGISTERED_FILES {
            if let Some(old) = order.pop_front() {
                map.remove(&old);
            }
        }
        token
    }

    async fn insert_sub(&self, path: PathBuf) -> String {
        let token = random_token();
        let mut map = self.subs.write().await;
        let mut order = self.sub_order.write().await;
        map.insert(token.clone(), path);
        order.push_back(token.clone());
        while order.len() > MAX_REGISTERED_SUBS {
            if let Some(old) = order.pop_front() {
                map.remove(&old);
            }
        }
        token
    }

    /// Registers a single user-chosen local video file and auto-discovers matching
    /// sibling subtitle files (`.srt`, `.vtt`, `.ass`, `.ssa`) in the same folder.
    pub async fn register(&self, base_url: &str, raw_path: &str) -> Result<Value, String> {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            return Err("No se indicó ningún archivo".to_string());
        }
        let path = PathBuf::from(trimmed);
        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|_| "No se encontró el archivo seleccionado".to_string())?;
        if !meta.is_file() {
            return Err("La ruta seleccionada no es un archivo válido".to_string());
        }
        if !is_local_video_path(&path) {
            return Err("El archivo no tiene un formato de video compatible".to_string());
        }
        let canonical = tokio::fs::canonicalize(&path).await.unwrap_or(path);
        let name = canonical
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("video.mp4")
            .to_string();
        let title = clean_title_from_stem(&canonical);
        let token = self.insert_file(canonical.clone()).await;

        // Discover sibling subtitle files in the same directory.
        let mut subtitles = Vec::new();
        if let Some(parent) = canonical.parent() {
            let video_stem_low = canonical
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let mut video_count = 0usize;
            let mut candidate_subs: Vec<PathBuf> = Vec::new();
            if let Ok(mut rd) = tokio::fs::read_dir(parent).await {
                while let Ok(Some(entry)) = rd.next_entry().await {
                    let p = entry.path();
                    if is_local_video_path(&p) {
                        video_count += 1;
                    } else if is_local_subtitle_path(&p) {
                        candidate_subs.push(p);
                    }
                }
            }
            candidate_subs.sort();
            for sub_path in candidate_subs {
                // A subtitle discovered next to the video must be a real file
                // inside that same folder: symlinks can point at any file the
                // app can read (e.g. config/tmdb.json or keystores).
                if tokio::fs::symlink_metadata(&sub_path)
                    .await
                    .map(|m| m.file_type().is_symlink())
                    .unwrap_or(true)
                {
                    continue;
                }
                let Ok(real_sub) = tokio::fs::canonicalize(&sub_path).await else {
                    continue;
                };
                if !real_sub.starts_with(parent) {
                    continue;
                }
                let sub_name = real_sub
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let sub_stem_low = real_sub
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let matches = video_count <= 1
                    || (!video_stem_low.is_empty() && sub_stem_low.starts_with(&video_stem_low));
                if !matches {
                    continue;
                }
                let sub_tok = self.insert_sub(real_sub).await;
                subtitles.push(json!({
                    "id": format!("local-sub-{sub_tok}"),
                    "lang": infer_sub_lang(&sub_name),
                    "label": format!("{sub_name} (local)"),
                    "url": format!("{base_url}/local-sub/{sub_tok}")
                }));
                if subtitles.len() >= 12 {
                    break;
                }
            }
        }

        Ok(json!({
            "token": token,
            "url": format!("{base_url}/local/{token}/{}", encode_path_segment(&name)),
            "name": name,
            "title": title,
            "size": meta.len(),
            "subtitles": subtitles
        }))
    }

    /// Scans a user-chosen local folder (or USB drive folder) up to depth 2,
    /// returning up to 200 video files sorted by newest first.
    pub async fn scan_folder(&self, raw_dir: &str) -> Result<Value, String> {
        let trimmed = raw_dir.trim().to_string();
        if trimmed.is_empty() {
            return Err("No se indicó ninguna carpeta".to_string());
        }
        let result = tokio::task::spawn_blocking(move || scan_dir_blocking(Path::new(&trimmed)))
            .await
            .map_err(|_| "No se pudo leer la carpeta".to_string())??;
        Ok(result)
    }

    pub async fn serve_file(
        &self,
        method: &Method,
        token: &str,
        req_headers: &HeaderMap,
    ) -> Response {
        let file_path = {
            let map = self.files.read().await;
            map.get(token).cloned()
        };
        let Some(file_path) = file_path else {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        };
        let Ok(meta) = tokio::fs::metadata(&file_path).await else {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        };
        if !meta.is_file() {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        }
        let total = meta.len();

        let range_hdr = req_headers
            .get(header::RANGE)
            .and_then(|v| v.to_str().ok());
        let range = match parse_range(range_hdr, total) {
            Ok(r) => r,
            Err(_) => {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                    .body(Body::empty())
                    .unwrap_or_else(|_| StatusCode::RANGE_NOT_SATISFIABLE.into_response());
            }
        };

        let (start, end, status) = match range {
            Some((s, e)) => (s, e, StatusCode::PARTIAL_CONTENT),
            None => (0, total.saturating_sub(1), StatusCode::OK),
        };
        let len = if total == 0 {
            0
        } else {
            end.saturating_sub(start) + 1
        };

        let path_str = file_path.to_string_lossy();
        let mut builder = Response::builder()
            .status(status)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_TYPE, mime_for_name(&path_str))
            .header(header::CONTENT_LENGTH, len.to_string())
            .header(header::CACHE_CONTROL, "no-store");

        if status == StatusCode::PARTIAL_CONTENT {
            builder = builder.header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{total}"),
            );
        }

        if method == Method::HEAD || len == 0 {
            return builder
                .body(Body::empty())
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }

        let mut file = match tokio::fs::File::open(&file_path).await {
            Ok(f) => f,
            Err(_) => return (StatusCode::NOT_FOUND, "Not found").into_response(),
        };
        if start > 0 && file.seek(SeekFrom::Start(start)).await.is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Seek error").into_response();
        }

        let limited = file.take(len);
        let reader_stream = stream::unfold(
            (limited, vec![0u8; 64 * 1024]),
            |(mut rdr, mut buf)| async move {
                match rdr.read(&mut buf).await {
                    Ok(0) => None,
                    Ok(n) => Some((
                        Ok::<Bytes, std::io::Error>(Bytes::copy_from_slice(&buf[..n])),
                        (rdr, buf),
                    )),
                    Err(e) => Some((Err(e), (rdr, buf))),
                }
            },
        );

        builder
            .body(Body::from_stream(reader_stream))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    }

    pub async fn serve_subtitle(&self, token: &str) -> Response {
        let cors = |b: axum::http::response::Builder| b.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        let not_found = || {
            cors(Response::builder())
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("Not found"))
                .unwrap()
        };
        let sub_path = {
            let map = self.subs.read().await;
            map.get(token).cloned()
        };
        let Some(sub_path) = sub_path else {
            return not_found();
        };
        // Re-check at serve time: the file may have been replaced by a symlink
        // since registration.
        if tokio::fs::symlink_metadata(&sub_path)
            .await
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
        {
            return not_found();
        }
        let Ok(meta) = tokio::fs::metadata(&sub_path).await else {
            return not_found();
        };
        if !meta.is_file() || meta.len() > MAX_SUBTITLE_BYTES {
            return not_found();
        }
        let Ok(bytes) = tokio::fs::read(&sub_path).await else {
            return not_found();
        };
        let ctype = if ext_lower(&sub_path) == "vtt" {
            "text/vtt; charset=utf-8"
        } else {
            "text/plain; charset=utf-8"
        };
        cors(Response::builder())
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, ctype)
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    }
}

fn scan_dir_blocking(root: &Path) -> Result<Value, String> {
    if !root.is_dir() {
        return Err("La carpeta seleccionada no existe o no es accesible".to_string());
    }
    let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut items: Vec<ScannedVideoItem> = Vec::new();
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    queue.push_back((canonical.clone(), 0));

    while let Some((dir, depth)) = queue.pop_front() {
        if items.len() >= MAX_SCAN_ITEMS {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if items.len() >= MAX_SCAN_ITEMS {
                break;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_dir() {
                if depth < 2 && !name.eq_ignore_ascii_case("System Volume Information") && !name.starts_with('$') {
                    queue.push_back((path, depth + 1));
                }
            } else if ft.is_file() && is_local_video_path(&path) {
                let Ok(meta) = entry.metadata() else {
                    continue;
                };
                let modified_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let folder = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                items.push(ScannedVideoItem {
                    path: path.to_string_lossy().to_string(),
                    title: clean_title_from_stem(&path),
                    ext: ext_lower(&path).to_ascii_uppercase(),
                    name,
                    size: meta.len(),
                    modified_ms,
                    folder,
                });
            }
        }
    }

    items.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.name.cmp(&b.name)));

    Ok(json!({
        "dir": canonical.to_string_lossy().to_string(),
        "items": items
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn registers_video_discovers_sibling_sub_and_serves_range() {
        let dir = std::env::temp_dir().join(format!("opentv-local-test-{}", random_token()));
        let _ = std::fs::create_dir_all(&dir);
        let vid = dir.join("Demo.Movie.2026.mkv");
        let sub = dir.join("Demo.Movie.2026.es.srt");
        let txt = dir.join("notes.txt");
        std::fs::write(&vid, b"0123456789abcdef").unwrap();
        std::fs::write(&sub, "1\n00:00:01,000 --> 00:00:03,000\nHola\n").unwrap();
        std::fs::write(&txt, b"ignore me").unwrap();

        let store = LocalMediaStore::new();

        // Rejects non-video file
        assert!(store.register("http://127.0.0.1:9999", txt.to_str().unwrap()).await.is_err());

        // Registers video + discovers sibling .es.srt
        let reg = store
            .register("http://127.0.0.1:9999", vid.to_str().unwrap())
            .await
            .expect("register ok");
        assert_eq!(reg["title"].as_str(), Some("Demo Movie 2026"));
        let subs = reg["subtitles"].as_array().unwrap();
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0]["lang"].as_str(), Some("es"));

        // Serves HTTP 206 Range request
        let tok = reg["token"].as_str().unwrap();
        let mut hdrs = HeaderMap::new();
        hdrs.insert(header::RANGE, "bytes=2-5".parse().unwrap());
        let resp = store.serve_file(&Method::GET, tok, &hdrs).await;
        assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);
        let bytes = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        assert_eq!(&bytes[..], b"2345");

        // Scans folder and finds only the video
        let scanned = store.scan_folder(dir.to_str().unwrap()).await.expect("scan ok");
        assert_eq!(scanned["items"].as_array().unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
