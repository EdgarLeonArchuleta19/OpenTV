use std::collections::{HashMap, HashSet, VecDeque};
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::{stream, StreamExt};
use librqbit::{AddTorrent, AddTorrentOptions};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{watch, Mutex, Notify, RwLock};
use url::Url;

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, header_map_from, FetchOptions};
use crate::torrents::{
    encode_path_segment, is_valid_info_hash, is_video_file, mime_for_name, parse_range, pick_file,
    FileHint, TorrentEngine, TorrentFileEntry,
};

const MAX_ACTIVE: usize = 2;
const MAX_ITEMS: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub target_id: String,
    pub item_id: String,
    pub poster: String,
    pub kind: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub allow_lan: bool,
    #[serde(default)]
    pub info_hash: String,
    #[serde(default)]
    pub file_idx: Option<usize>,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub duration: f64,
    pub file: String,
    pub status: String,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub total: u64,
    #[serde(skip)]
    pub speed: u64,
    #[serde(default)]
    pub error: String,
    pub created: u64,
    #[serde(default)]
    pub finished: Option<u64>,
    #[serde(default)]
    pub resume_on_start: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishedNotice {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub error: Option<String>,
}

struct RunningHandle {
    cancel_tx: watch::Sender<bool>,
    run_id: u64,
}

#[derive(Clone)]
pub struct DownloadManager {
    dns: Dnsx,
    torrents: TorrentEngine,
    dir: PathBuf,
    parts_dir: PathBuf,
    state_file: PathBuf,
    items: Arc<RwLock<Vec<DownloadItem>>>,
    running: Arc<Mutex<HashMap<String, RunningHandle>>>,
    run_seq: Arc<std::sync::atomic::AtomicU64>,
    notices: Arc<Mutex<VecDeque<FinishedNotice>>>,
    pump_notify: Arc<Notify>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn random_hex(n: usize) -> String {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    let mut s = String::with_capacity(n * 2);
    for b in buf {
        use std::fmt::Write;
        let _ = write!(&mut s, "{b:02x}");
    }
    s
}

/// Exact port of `service/downloads.js#safeName` (Windows-safe filenames).
pub fn safe_name(text: &str) -> String {
    let mut cleaned = String::with_capacity(text.len());
    for ch in text.chars() {
        let forbidden = matches!(
            ch,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        ) || (ch as u32) < 0x20;
        if forbidden {
            cleaned.push(' ');
        } else {
            cleaned.push(ch);
        }
    }
    let collapsed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_end_matches(['.', ' ']);
    let limited: String = trimmed.chars().take(120).collect();
    let final_s = limited.trim_start_matches(['.', ' ']).trim_end_matches(['.', ' ']);
    if final_s.is_empty() {
        "Video".to_string()
    } else if is_windows_reserved_name(final_s) {
        // `CON`, `NUL.mkv`, `COM1.txt`... open devices instead of files on Windows.
        format!("_{final_s}")
    } else {
        final_s.to_string()
    }
}

/// Windows reserved device names (also with any extension, e.g. `aux.mp4`, and the
/// superscript-digit variants `COM¹`/`LPT²`).
pub fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end_matches(' ');
    let upper = stem.to_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return true;
    }
    for prefix in ["COM", "LPT"] {
        if let Some(rest) = upper.strip_prefix(prefix) {
            let mut chars = rest.chars();
            if let (Some(c), None) = (chars.next(), chars.next()) {
                if c.is_ascii_digit() || matches!(c, '\u{b9}' | '\u{b2}' | '\u{b3}') {
                    return true;
                }
            }
        }
    }
    false
}

fn ext_from(text: &str, fallback: &str) -> String {
    let clean = text.split(['?', '#']).next().unwrap_or(text);
    if let Some(ext) = clean.rsplit('.').next() {
        let low = ext.to_ascii_lowercase();
        if matches!(
            low.as_str(),
            "mp4" | "m4v" | "mkv" | "webm" | "avi" | "mov" | "ts" | "m2ts"
        ) {
            return format!(".{low}");
        }
    }
    fallback.to_string()
}

fn file_exists(path: &str) -> bool {
    Path::new(path).is_file()
}

struct SpeedMeter {
    samples: VecDeque<(Instant, u64)>,
}

impl SpeedMeter {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(16),
        }
    }

    fn update(&mut self, bytes: u64) -> u64 {
        let now = Instant::now();
        self.samples.push_back((now, bytes));
        while self.samples.len() > 2 {
            if let Some((t0, _)) = self.samples.front() {
                if now.duration_since(*t0) > Duration::from_secs(4) {
                    self.samples.pop_front();
                    continue;
                }
            }
            break;
        }
        if let Some((t0, b0)) = self.samples.front() {
            let dt = now.duration_since(*t0).as_millis() as u64;
            if dt > 0 && bytes >= *b0 {
                return ((bytes - *b0).saturating_mul(1000)) / dt;
            }
        }
        0
    }
}

impl DownloadManager {
    pub fn new(dns: Dnsx, torrents: TorrentEngine, dir: PathBuf) -> Self {
        let parts_dir = dir.join(".partes");
        let state_file = dir.join(".opentv-descargas.json");
        let loaded = load_persisted(&state_file);

        let mgr = Self {
            dns,
            torrents,
            dir,
            parts_dir,
            state_file,
            items: Arc::new(RwLock::new(loaded)),
            running: Arc::new(Mutex::new(HashMap::new())),
            run_seq: Arc::new(std::sync::atomic::AtomicU64::new(1)),
            notices: Arc::new(Mutex::new(VecDeque::new())),
            pump_notify: Arc::new(Notify::new()),
        };

        // Background pump task: starts queued downloads whenever notified.
        let boot = mgr.clone();
        tokio::spawn(async move {
            loop {
                boot.pump().await;
                boot.pump_notify.notified().await;
            }
        });

        mgr
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    async fn save_now(&self) {
        let _ = tokio::fs::create_dir_all(&self.dir).await;
        let snapshot = self.items.read().await.clone();
        if let Ok(json_bytes) = serde_json::to_vec(&snapshot) {
            let tmp = self.state_file.with_extension("json.tmp");
            if tokio::fs::write(&tmp, &json_bytes).await.is_ok() {
                let _ = tokio::fs::rename(&tmp, &self.state_file).await;
            }
        }
    }

    fn unique_file(&self, items: &[DownloadItem], base: &str, ext: &str) -> String {
        let taken: HashSet<String> = items
            .iter()
            .map(|it| it.file.to_ascii_lowercase())
            .collect();
        for n in 1..1000 {
            let candidate = if n == 1 {
                self.dir.join(format!("{base}{ext}"))
            } else {
                self.dir.join(format!("{base} ({n}){ext}"))
            };
            let s = candidate.to_string_lossy().to_string();
            let part = format!("{s}.part");
            if !taken.contains(&s.to_ascii_lowercase())
                && !Path::new(&s).exists()
                && !Path::new(&part).exists()
            {
                return s;
            }
        }
        self.dir
            .join(format!("{base} {}{ext}", now_ms()))
            .to_string_lossy()
            .to_string()
    }

    pub async fn start(&self, p: &Value) -> Result<Value, String> {
        let info_hash_raw = p["infoHash"].as_str().unwrap_or("").trim();
        let url_raw = p["url"].as_str().unwrap_or("").trim();

        let kind = if !info_hash_raw.is_empty() {
            "torrent"
        } else if url_raw.to_ascii_lowercase().contains(".m3u8") {
            "hls"
        } else {
            "direct"
        };

        if kind == "torrent" && !is_valid_info_hash(info_hash_raw) {
            return Err("El torrent no es válido".to_string());
        }
        if kind != "torrent"
            && !(url_raw.starts_with("http://") || url_raw.starts_with("https://"))
        {
            return Err("La fuente no tiene un enlace http(s) válido".to_string());
        }

        let target_id = p["targetId"].as_str().unwrap_or("").to_string();

        // Deduplicate by targetId if active/done/paused.
        if !target_id.is_empty() {
            let mut resumed = false;
            let mut existing_id: Option<String> = None;
            {
                let mut items = self.items.write().await;
                for it in items.iter_mut() {
                    if it.target_id == target_id
                        && it.status != "error"
                        && it.status != "missing"
                    {
                        if it.status == "paused" {
                            it.status = "queued".to_string();
                            resumed = true;
                        }
                        existing_id = Some(it.id.clone());
                        break;
                    }
                }
            }
            if let Some(id) = existing_id {
                if resumed {
                    self.save_now().await;
                    self.pump_notify.notify_one();
                }
                return Ok(json!({ "id": id, "existing": true }));
            }
        }

        let _ = tokio::fs::create_dir_all(&self.dir).await;

        let title: String = p["title"].as_str().unwrap_or("").chars().take(200).collect();
        let subtitle: String = p["subtitle"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(200)
            .collect();
        let poster_raw = p["poster"].as_str().unwrap_or("");
        let poster = if poster_raw.starts_with("http://") || poster_raw.starts_with("https://") {
            poster_raw.to_string()
        } else {
            String::new()
        };

        let mut headers = HashMap::new();
        if let Some(obj) = p["headers"].as_object() {
            for (k, v) in obj {
                if let Some(s) = v.as_str() {
                    if !k.contains(['\r', '\n']) && !s.contains(['\r', '\n']) {
                        headers.insert(k.clone(), s.to_string());
                    }
                }
            }
        }

        let file_idx = p["fileIdx"]
            .as_u64()
            .map(|n| n as usize)
            .or_else(|| p["fileIdx"].as_str().and_then(|s| s.trim().parse().ok()));

        let sources: Vec<String> = p["sources"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .take(50)
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        let base_label = if subtitle.is_empty() {
            title.clone()
        } else {
            format!("{title} - {subtitle}")
        };
        let base = safe_name(&base_label);
        let filename_hint = p["filename"].as_str().unwrap_or("");
        let ext = if kind == "hls" {
            ".ts".to_string()
        } else {
            let hint_src = if !filename_hint.is_empty() {
                filename_hint
            } else {
                url_raw
            };
            ext_from(hint_src, ".mkv")
        };

        let id = random_hex(8);
        let mut dropped_ids: Vec<String> = Vec::new();
        {
            let mut items = self.items.write().await;
            let file_path = self.unique_file(&items, &base, &ext);
            let item = DownloadItem {
                id: id.clone(),
                title,
                subtitle,
                target_id,
                item_id: p["itemId"].as_str().unwrap_or("").to_string(),
                poster,
                kind: kind.to_string(),
                url: url_raw.to_string(),
                headers,
                allow_lan: p["allowLan"].as_bool().unwrap_or(false)
                    || p["allowLan"].as_str() == Some("true"),
                info_hash: if kind == "torrent" {
                    info_hash_raw.to_ascii_lowercase()
                } else {
                    String::new()
                },
                file_idx,
                sources,
                duration: p["duration"].as_f64().unwrap_or(0.0),
                file: file_path,
                status: "queued".to_string(),
                bytes: 0,
                total: 0,
                speed: 0,
                error: String::new(),
                created: now_ms(),
                finished: None,
                resume_on_start: false,
            };
            items.insert(0, item);
            while items.len() > MAX_ITEMS {
                if let Some(old) = items.pop() {
                    dropped_ids.push(old.id);
                }
            }
        }

        for old_id in dropped_ids {
            self.halt(&old_id).await;
        }

        self.save_now().await;
        self.pump_notify.notify_one();
        Ok(json!({ "id": id }))
    }

    pub async fn list(&self) -> Value {
        let items = self.items.read().await;
        let out: Vec<Value> = items.iter().map(public_item).collect();
        json!({
            "items": out,
            "dir": self.dir.to_string_lossy()
        })
    }

    pub async fn snapshot(&self, drain_notices: bool) -> Value {
        let items = self.items.read().await;
        let mut count = 0usize;
        let mut bytes = 0u64;
        let mut total = 0u64;
        let mut speed = 0u64;
        let mut primary: Option<&DownloadItem> = None;

        for it in items.iter() {
            if it.status == "downloading" || it.status == "queued" {
                count += 1;
                bytes = bytes.saturating_add(it.bytes);
                total = total.saturating_add(it.total);
                speed = speed.saturating_add(it.speed);
                if primary.is_none() || (primary.unwrap().status != "downloading" && it.status == "downloading") {
                    primary = Some(it);
                }
            }
        }

        let finished_notices: Vec<FinishedNotice> = if drain_notices {
            let mut q = self.notices.lock().await;
            q.drain(..).collect()
        } else {
            Vec::new()
        };

        let (id, title, subtitle, status) = match primary {
            Some(p) => (
                p.id.clone(),
                p.title.clone(),
                p.subtitle.clone(),
                p.status.clone(),
            ),
            None => (String::new(), String::new(), String::new(), String::new()),
        };

        json!({
            "count": count,
            "id": id,
            "title": title,
            "subtitle": subtitle,
            "status": status,
            "bytes": bytes,
            "total": total,
            "speed": speed,
            "notices": finished_notices
        })
    }

    pub async fn action(&self, id: &str, what: &str) -> Result<Value, String> {
        let snapshot_item: DownloadItem;
        match what {
            "pause" => {
                self.halt(id).await;
                let mut items = self.items.write().await;
                let Some(it) = items.iter_mut().find(|x| x.id == id) else {
                    return Err("Esa descarga ya no existe".to_string());
                };
                if it.status == "downloading" || it.status == "queued" {
                    it.status = "paused".to_string();
                    it.speed = 0;
                }
                snapshot_item = it.clone();
            }
            "resume" => {
                let mut items = self.items.write().await;
                let Some(it) = items.iter_mut().find(|x| x.id == id) else {
                    return Err("Esa descarga ya no existe".to_string());
                };
                if it.status == "paused" || it.status == "error" {
                    it.status = "queued".to_string();
                    it.error.clear();
                }
                snapshot_item = it.clone();
            }
            "remove" | "delete" => {
                self.halt(id).await;
                let removed = {
                    let mut items = self.items.write().await;
                    let Some(pos) = items.iter().position(|x| x.id == id) else {
                        return Err("Esa descarga ya no existe".to_string());
                    };
                    items.remove(pos)
                };
                let part = format!("{}.part", removed.file);
                let _ = tokio::fs::remove_file(&part).await;
                if !removed.info_hash.is_empty() {
                    let tdir = self
                        .parts_dir
                        .join(format!("{}-{}", removed.info_hash, removed.id));
                    let _ = tokio::fs::remove_dir_all(&tdir).await;
                }
                if what == "delete" || removed.status != "done" {
                    let _ = tokio::fs::remove_file(&removed.file).await;
                }
                snapshot_item = removed;
            }
            _ => return Err("Acción desconocida".to_string()),
        }

        self.save_now().await;
        self.pump_notify.notify_one();
        Ok(public_item(&snapshot_item))
    }

    pub async fn open(&self, base_url: &str, id: &str) -> Result<Value, String> {
        let mut missing = false;
        let out = {
            let mut items = self.items.write().await;
            let Some(it) = items.iter_mut().find(|x| x.id == id) else {
                return Err("La descarga no está completa".to_string());
            };
            if it.status != "done" {
                return Err("La descarga no está completa".to_string());
            }
            if !file_exists(&it.file) {
                it.status = "missing".to_string();
                missing = true;
                None
            } else {
                let name = Path::new(&it.file)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("video.mkv")
                    .to_string();
                Some(json!({
                    "url": format!("{}/d/{}/{}", base_url, it.id, encode_path_segment(&name)),
                    "name": name
                }))
            }
        };

        if missing {
            self.save_now().await;
            return Err(format!(
                "El archivo ya no está en {}",
                self.dir.to_string_lossy()
            ));
        }

        Ok(out.unwrap())
    }

    pub async fn serve_download(
        &self,
        method: &Method,
        id: &str,
        req_headers: &HeaderMap,
    ) -> Response {
        let file_path = {
            let items = self.items.read().await;
            items
                .iter()
                .find(|x| x.id == id && x.status == "done")
                .map(|x| x.file.clone())
        };
        let Some(file_path) = file_path else {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        };
        let Ok(meta) = tokio::fs::metadata(&file_path).await else {
            return (StatusCode::NOT_FOUND, "Not found").into_response();
        };
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

        let mut builder = Response::builder()
            .status(status)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_TYPE, mime_for_name(&file_path))
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

    async fn halt(&self, id: &str) {
        let handle = self.running.lock().await.remove(id);
        if let Some(h) = handle {
            let _ = h.cancel_tx.send(true);
        }
    }

    async fn pump(&self) {
        let mut to_start: Vec<DownloadItem> = Vec::new();
        {
            let running = self.running.lock().await;
            let mut active = running.len();
            if active < MAX_ACTIVE {
                let mut items = self.items.write().await;
                for it in items.iter_mut().rev() {
                    if active >= MAX_ACTIVE {
                        break;
                    }
                    if it.status != "queued" || running.contains_key(&it.id) {
                        continue;
                    }
                    it.status = "downloading".to_string();
                    it.error.clear();
                    to_start.push(it.clone());
                    active += 1;
                }
            }
        }

        for item in to_start {
            let run_id = self
                .run_seq
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let (tx, rx) = watch::channel(false);
            {
                let mut running = self.running.lock().await;
                running.insert(
                    item.id.clone(),
                    RunningHandle {
                        cancel_tx: tx,
                        run_id,
                    },
                );
            }
            let mgr = self.clone();
            tokio::spawn(async move {
                let res = match item.kind.as_str() {
                    "torrent" => mgr.run_torrent(&item, rx.clone()).await,
                    "hls" => mgr.run_hls(&item, rx.clone()).await,
                    _ => mgr.run_direct(&item, rx.clone()).await,
                };
                let cancelled = *rx.borrow();
                mgr.finish_run(&item.id, run_id, cancelled, res).await;
            });
        }

        self.save_now().await;
    }

    async fn finish_run(
        &self,
        id: &str,
        run_id: u64,
        cancelled: bool,
        res: Result<(), String>,
    ) {
        {
            let mut running = self.running.lock().await;
            if let Some(h) = running.get(id) {
                if h.run_id != run_id {
                    return; // Superseded by a newer run.
                }
            } else if cancelled {
                return;
            }
            running.remove(id);
        }

        let mut notice: Option<FinishedNotice> = None;
        {
            let mut items = self.items.write().await;
            if let Some(it) = items.iter_mut().find(|x| x.id == id) {
                it.speed = 0;
                if it.status == "downloading" && !cancelled {
                    match res {
                        Ok(()) => {
                            it.status = "done".to_string();
                            it.finished = Some(now_ms());
                            notice = Some(FinishedNotice {
                                id: it.id.clone(),
                                title: it.title.clone(),
                                subtitle: it.subtitle.clone(),
                                error: None,
                            });
                        }
                        Err(err) => {
                            let short: String = err.chars().take(300).collect();
                            it.status = "error".to_string();
                            it.error = short.clone();
                            notice = Some(FinishedNotice {
                                id: it.id.clone(),
                                title: it.title.clone(),
                                subtitle: it.subtitle.clone(),
                                error: Some(short),
                            });
                        }
                    }
                }
            }
        }

        if let Some(n) = notice {
            let mut q = self.notices.lock().await;
            q.push_back(n);
            while q.len() > 20 {
                q.pop_front();
            }
        }

        self.save_now().await;
        self.pump_notify.notify_one();
    }

    async fn update_progress(
        &self,
        id: &str,
        bytes: u64,
        total: Option<u64>,
        speed: u64,
    ) {
        let mut items = self.items.write().await;
        if let Some(it) = items.iter_mut().find(|x| x.id == id) {
            it.bytes = bytes;
            if let Some(t) = total {
                if t > 0 {
                    it.total = t;
                }
            }
            it.speed = speed;
        }
    }

    async fn run_direct(
        &self,
        item: &DownloadItem,
        cancel_rx: watch::Receiver<bool>,
    ) -> Result<(), String> {
        let part_path = format!("{}.part", item.file);
        let mut have = tokio::fs::metadata(&part_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);

        let mut hmap = header_map_from(&item.headers);
        if !hmap.contains_key(reqwest::header::USER_AGENT) {
            hmap.insert(
                reqwest::header::USER_AGENT,
                reqwest::header::HeaderValue::from_static("Mozilla/5.0 OpenTV"),
            );
        }
        if have > 0 {
            hmap.insert(
                reqwest::header::RANGE,
                reqwest::header::HeaderValue::from_str(&format!("bytes={have}-"))
                    .map_err(|e| e.to_string())?,
            );
        }
        let mut opts = FetchOptions::new(&self.dns, item.allow_lan, Duration::from_secs(3600));
        opts.streaming = true; // large downloads must not hit a total timeout
        opts.headers = hmap;

        let resp = fetch_url(&item.url, opts)
            .await
            .map_err(|e| format!("No se pudo conectar: {e}"))?;

        let status = resp.status().as_u16();
        if status == 416 && have > 0 {
            // Already complete on disk.
            tokio::fs::rename(&part_path, &item.file)
                .await
                .map_err(|e| format!("No se pudo guardar el archivo: {e}"))?;
            self.update_progress(&item.id, have, Some(have), 0).await;
            return Ok(());
        }

        if status != 200 && status != 206 {
            let suffix = if status == 403 || status == 410 {
                ": el enlace caducó, vuelve a descargar desde la ficha"
            } else {
                ""
            };
            return Err(format!("El servidor respondió {status}{suffix}"));
        }

        if status == 200 {
            have = 0;
        }

        let total = parse_content_range_total(
            resp.headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok()),
        )
        .unwrap_or_else(|| have + resp.content_length().unwrap_or(0));

        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(have > 0)
            .truncate(have == 0)
            .open(&part_path)
            .await
            .map_err(|e| format!("No se pudo escribir el archivo: {e}"))?;

        let mut downloaded = have;
        let mut meter = SpeedMeter::new();
        self.update_progress(&item.id, downloaded, Some(total), 0)
            .await;

        let mut stream = resp.bytes_stream();
        let mut last_ui = Instant::now();

        while let Some(chunk_res) = stream.next().await {
            if *cancel_rx.borrow() {
                let _ = file.flush().await;
                return Ok(());
            }
            let chunk = chunk_res.map_err(|e| format!("La descarga se cortó: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Error al guardar en disco: {e}"))?;
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            let spd = meter.update(downloaded);
            if last_ui.elapsed() >= Duration::from_millis(350) {
                last_ui = Instant::now();
                self.update_progress(&item.id, downloaded, Some(total), spd)
                    .await;
            }
        }

        file.flush()
            .await
            .map_err(|e| format!("Error al cerrar archivo: {e}"))?;
        drop(file);

        if *cancel_rx.borrow() {
            return Ok(());
        }
        if total > 0 && downloaded < total {
            return Err("La descarga se cortó; reanúdala".to_string());
        }

        tokio::fs::rename(&part_path, &item.file)
            .await
            .map_err(|e| format!("No se pudo mover el archivo final: {e}"))?;
        self.update_progress(
            &item.id,
            downloaded,
            Some(if total > 0 { total } else { downloaded }),
            0,
        )
        .await;
        Ok(())
    }

    /// Pure-Rust HLS (.m3u8) downloader — ZERO FFmpeg required!
    async fn run_hls(
        &self,
        item: &DownloadItem,
        cancel_rx: watch::Receiver<bool>,
    ) -> Result<(), String> {
        let mut playlist_url = item.url.clone();
        let mut text = self.fetch_text_with_headers(&playlist_url, &item.headers, item.allow_lan).await?;

        // If master playlist, pick highest bandwidth variant.
        if text.contains("#EXT-X-STREAM-INF") {
            if let Some(best_variant) = pick_best_hls_variant(&playlist_url, &text) {
                playlist_url = best_variant;
                text = self
                    .fetch_text_with_headers(&playlist_url, &item.headers, item.allow_lan)
                    .await?;
            }
        }

        if text.contains("METHOD=SAMPLE-AES") {
            return Err("Este stream HLS tiene DRM y no se puede descargar".to_string());
        }

        let (init_map, segments) = parse_hls_segments(&playlist_url, &text);
        if segments.is_empty() {
            return Err("La lista HLS no tiene segmentos descargables".to_string());
        }

        // If fMP4 init map is present, switch extension to .mp4 cleanly.
        let mut final_file = item.file.clone();
        if init_map.is_some() && final_file.ends_with(".ts") {
            final_file = format!("{}.mp4", &final_file[..final_file.len() - 3]);
            let mut items = self.items.write().await;
            if let Some(it) = items.iter_mut().find(|x| x.id == item.id) {
                it.file = final_file.clone();
            }
        }

        let part_path = format!("{final_file}.part");
        let mut file = tokio::fs::File::create(&part_path)
            .await
            .map_err(|e| format!("No se pudo crear el archivo: {e}"))?;

        let mut bytes: u64 = 0;
        let mut meter = SpeedMeter::new();
        let total_segs = segments.len() as u64;

        let mut all_urls: Vec<String> = Vec::with_capacity(segments.len() + 1);
        if let Some(init) = init_map {
            all_urls.push(init);
        }
        all_urls.extend(segments);

        for (idx, seg_url) in all_urls.iter().enumerate() {
            if *cancel_rx.borrow() {
                drop(file);
                let _ = tokio::fs::remove_file(&part_path).await;
                return Ok(());
            }

            let seg_bytes = self
                .fetch_bytes_with_headers(seg_url, &item.headers, item.allow_lan)
                .await?;
            file.write_all(&seg_bytes)
                .await
                .map_err(|e| format!("Error al escribir segmento: {e}"))?;
            bytes = bytes.saturating_add(seg_bytes.len() as u64);
            let spd = meter.update(bytes);
            let done_segs = (idx as u64 + 1).max(1);
            let est_total = bytes.saturating_mul(total_segs.max(done_segs)) / done_segs;
            self.update_progress(&item.id, bytes, Some(est_total), spd)
                .await;
        }

        file.flush()
            .await
            .map_err(|e| format!("Error al guardar vídeo HLS: {e}"))?;
        drop(file);

        if *cancel_rx.borrow() {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Ok(());
        }

        tokio::fs::rename(&part_path, &final_file)
            .await
            .map_err(|e| format!("No se pudo guardar el archivo final: {e}"))?;
        self.update_progress(&item.id, bytes, Some(bytes), 0).await;
        Ok(())
    }

    async fn run_torrent(
        &self,
        item: &DownloadItem,
        mut cancel_rx: watch::Receiver<bool>,
    ) -> Result<(), String> {
        let dir = self
            .parts_dir
            .join(format!("{}-{}", item.info_hash, item.id));
        let _ = tokio::fs::create_dir_all(&dir).await;

        let session = self.torrents.create_dedicated_session(dir.clone()).await?;
        let trackers = self.torrents.build_trackers(&item.sources).await;
        let magnet = crate::torrents::build_magnet_uri(&item.info_hash, &trackers);

        let add_opts = AddTorrentOptions {
            overwrite: true,
            paused: false,
            trackers: Some(trackers),
            ..Default::default()
        };

        let add_fut = tokio::time::timeout(
            Duration::from_secs(90),
            session.add_torrent(AddTorrent::from_url(magnet), Some(add_opts)),
        );
        let resp = tokio::select! {
            _ = cancel_rx.changed() => {
                drop(session);
                return Ok(());
            }
            r = add_fut => match r {
                Ok(Ok(v)) => v,
                Ok(Err(e)) => return Err(format!("No se pudo abrir el torrent: {e}")),
                Err(_) => return Err("No se encontraron fuentes para este torrent.".to_string()),
            }
        };
        let handle = resp
            .into_handle()
            .ok_or_else(|| "No se pudo abrir el torrent".to_string())?;

        // Wait up to 120s for metadata.
        let meta_deadline = Instant::now() + Duration::from_secs(120);
        let chosen: (usize, PathBuf, u64) = loop {
            if *cancel_rx.borrow() {
                drop(session);
                return Ok(());
            }
            let meta_res = handle.with_metadata(|m| {
                m.file_infos
                    .iter()
                    .map(|fi| {
                        (
                            TorrentFileEntry {
                                name: fi.relative_filename.to_string_lossy().to_string(),
                                length: fi.len,
                            },
                            fi.relative_filename.clone(),
                        )
                    })
                    .collect::<Vec<_>>()
            });
            if let Ok(list) = meta_res {
                let entries: Vec<TorrentFileEntry> = list.iter().map(|(e, _)| e.clone()).collect();
                let hint = FileHint {
                    file_idx: item.file_idx,
                    ..Default::default()
                };
                let fid = pick_file(&entries, &hint)
                    .ok_or_else(|| "El torrent no tiene ningún vídeo".to_string())?;
                break (fid, list[fid].1.clone(), entries[fid].length);
            }
            if Instant::now() >= meta_deadline {
                drop(session);
                return Err(
                    "No se encontraron personas compartiendo este torrent. Prueba más tarde u otra fuente."
                        .to_string(),
                );
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        };

        let (file_id, rel_path, file_len) = chosen;
        let mut only = HashSet::new();
        only.insert(file_id);
        let _ = session.update_only_files(&handle, &only).await;

        // Match final extension to actual video file in torrent.
        let mut final_file = item.file.clone();
        if let Some(ext) = rel_path.extension().and_then(|s| s.to_str()) {
            let dot_ext = format!(".{}", ext.to_ascii_lowercase());
            if is_video_file(&rel_path.to_string_lossy()) && !final_file.to_ascii_lowercase().ends_with(&dot_ext) {
                if let Some(pos) = final_file.rfind('.') {
                    final_file = format!("{}{dot_ext}", &final_file[..pos]);
                    let mut items = self.items.write().await;
                    if let Some(it) = items.iter_mut().find(|x| x.id == item.id) {
                        it.file = final_file.clone();
                    }
                }
            }
        }

        let mut meter = SpeedMeter::new();
        self.update_progress(&item.id, 0, Some(file_len), 0).await;

        loop {
            if *cancel_rx.borrow() {
                drop(session);
                return Ok(());
            }
            let st = handle.stats();
            if let Some(err) = st.error {
                drop(session);
                return Err(err);
            }
            let have = st
                .file_progress
                .get(file_id)
                .copied()
                .unwrap_or(st.progress_bytes)
                .min(file_len);
            let spd = st
                .live
                .as_ref()
                .map(|l| l.download_speed.as_bytes())
                .unwrap_or_else(|| meter.update(have));
            self.update_progress(&item.id, have, Some(file_len), spd)
                .await;

            if st.finished || (file_len > 0 && have >= file_len) {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }

        let src_path = handle.output_folder().join(&rel_path);
        drop(handle);
        drop(session);

        // Move completed video into Downloads root folder (copy fallback across volumes).
        if tokio::fs::rename(&src_path, &final_file).await.is_err() {
            tokio::fs::copy(&src_path, &final_file)
                .await
                .map_err(|e| format!("No se pudo guardar el vídeo descargado: {e}"))?;
        }
        let _ = tokio::fs::remove_dir_all(&dir).await;
        self.update_progress(&item.id, file_len, Some(file_len), 0)
            .await;
        Ok(())
    }

    async fn fetch_text_with_headers(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        allow_lan: bool,
    ) -> Result<String, String> {
        let bytes = self.fetch_bytes_with_headers(url, headers, allow_lan).await?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    async fn fetch_bytes_with_headers(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        allow_lan: bool,
    ) -> Result<Bytes, String> {
        let mut hmap = header_map_from(headers);
        if !hmap.contains_key(reqwest::header::USER_AGENT) {
            hmap.insert(
                reqwest::header::USER_AGENT,
                reqwest::header::HeaderValue::from_static("Mozilla/5.0 OpenTV"),
            );
        }
        let mut opts = FetchOptions::new(&self.dns, allow_lan, Duration::from_secs(30));
        opts.headers = hmap;
        let resp = fetch_url(url, opts)
            .await
            .map_err(|e| format!("Error descargando HLS: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("El servidor HLS respondió {}", resp.status().as_u16()));
        }
        resp.bytes()
            .await
            .map_err(|e| format!("Error leyendo segmento HLS: {e}"))
    }
}

fn load_persisted(state_file: &Path) -> Vec<DownloadItem> {
    let Ok(bytes) = std::fs::read(state_file) else {
        return Vec::new();
    };
    let Ok(mut list) = serde_json::from_slice::<Vec<DownloadItem>>(&bytes) else {
        return Vec::new();
    };
    for it in &mut list {
        if it.status == "downloading" || it.status == "queued" || it.resume_on_start {
            it.status = "queued".to_string();
        }
        it.resume_on_start = false;
        it.speed = 0;
        if it.status == "done" && !file_exists(&it.file) {
            it.status = "missing".to_string();
        }
    }
    list.retain(|it| !it.id.is_empty() && !it.file.is_empty());
    list
}

fn public_item(it: &DownloadItem) -> Value {
    let file_name = Path::new(&it.file)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    json!({
        "id": it.id,
        "title": it.title,
        "subtitle": it.subtitle,
        "targetId": it.target_id,
        "itemId": it.item_id,
        "poster": it.poster,
        "kind": it.kind,
        "status": it.status,
        "bytes": it.bytes,
        "total": it.total,
        "speed": it.speed,
        "error": it.error,
        "fileName": file_name,
        "created": it.created
    })
}

fn parse_content_range_total(header: Option<&str>) -> Option<u64> {
    let h = header?;
    let (_, tail) = h.rsplit_once('/')?;
    tail.trim().parse::<u64>().ok()
}

fn pick_best_hls_variant(base_url: &str, text: &str) -> Option<String> {
    let base = Url::parse(base_url).ok()?;
    let mut best_bw: u64 = 0;
    let mut best_url: Option<String> = None;
    let mut pending_bw: Option<u64> = None;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(attrs) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let bw = attrs
                .split(',')
                .find_map(|p| {
                    let (k, v) = p.trim().split_once('=')?;
                    if k.eq_ignore_ascii_case("BANDWIDTH") {
                        v.trim().parse::<u64>().ok()
                    } else {
                        None
                    }
                })
                .unwrap_or(1);
            pending_bw = Some(bw);
        } else if !line.starts_with('#') {
            if let Some(bw) = pending_bw.take() {
                if bw >= best_bw {
                    if let Ok(resolved) = base.join(line) {
                        best_bw = bw;
                        best_url = Some(resolved.to_string());
                    }
                }
            }
        }
    }
    best_url
}

fn parse_hls_segments(base_url: &str, text: &str) -> (Option<String>, Vec<String>) {
    let Ok(base) = Url::parse(base_url) else {
        return (None, Vec::new());
    };
    let mut init_map: Option<String> = None;
    let mut segs: Vec<String> = Vec::new();

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXT-X-MAP:") {
            if let Some(uri_part) = rest.split("URI=\"").nth(1) {
                if let Some(uri) = uri_part.split('"').next() {
                    if let Ok(resolved) = base.join(uri) {
                        init_map = Some(resolved.to_string());
                    }
                }
            }
        } else if !line.starts_with('#') {
            if let Ok(resolved) = base.join(line) {
                segs.push(resolved.to_string());
            }
        }
    }
    (init_map, segs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_name_is_windows_safe() {
        assert_eq!(
            safe_name("Misión: Imposible / Parte 1?"),
            "Misión Imposible Parte 1"
        );
        assert_eq!(safe_name("   "), "Video");
        assert_eq!(safe_name("Nombre."), "Nombre");
    }

    #[test]
    fn safe_name_renames_windows_reserved_device_names() {
        for (input, expected) in [
            ("CON", "_CON"),
            ("con", "_con"),
            ("NUL.mkv", "_NUL.mkv"),
            ("aux.mp4", "_aux.mp4"),
            ("PRN", "_PRN"),
            ("COM1", "_COM1"),
            ("lpt9.txt", "_lpt9.txt"),
            ("COM\u{b9}", "_COM\u{b9}"),
            ("CON .", "_CON"),
            ("NUL . . ", "_NUL"),
        ] {
            assert_eq!(safe_name(input), expected, "{input}");
        }
        // Lookalikes stay untouched.
        for ok in ["Console", "COM10", "LPT", "Nullify", "Aux Cables", "CONTRA.mkv"] {
            assert_eq!(safe_name(ok), ok);
        }
        // Leading/trailing dots and spaces never survive.
        assert_eq!(safe_name(" ..Peli. . "), "Peli");
        assert_eq!(safe_name("..."), "Video");
    }

    #[test]
    fn parses_hls_master_and_media_playlists() {
        let master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=4500000\nhigh/index.m3u8\n";
        let best = pick_best_hls_variant("https://cdn.example/vod/master.m3u8", master).unwrap();
        assert_eq!(best, "https://cdn.example/vod/high/index.m3u8");

        let media = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6.0,\nseg1.m4s\n#EXTINF:6.0,\nseg2.m4s\n#EXT-X-ENDLIST\n";
        let (init, segs) = parse_hls_segments(&best, media);
        assert_eq!(init.as_deref(), Some("https://cdn.example/vod/high/init.mp4"));
        assert_eq!(
            segs,
            vec![
                "https://cdn.example/vod/high/seg1.m4s".to_string(),
                "https://cdn.example/vod/high/seg2.m4s".to_string()
            ]
        );
    }
}
