use std::collections::HashSet;
use std::io::SeekFrom;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::stream;
use librqbit::api::TorrentIdOrHash;
use librqbit::dht::DhtPersistenceConfig;
use librqbit::{
    AddTorrent, AddTorrentOptions, ConnectionOptions, DhtSessionConfig, ListenerMode,
    ListenerOptions, ManagedTorrent, PeerConnectionOptions, Session, SessionOptions,
};

type ManagedTorrentHandle = Arc<ManagedTorrent>;
type PrefetchGuard = Box<dyn std::any::Any + Send + Sync>;
use rand::RngCore;
use regex::Regex;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::{Mutex, RwLock};
use tokio::task::AbortHandle;

const READY_TIMEOUT_MS: u64 = 45_000;
const IDLE_STOP_MS: u64 = 10 * 60 * 1000;
const RACE_TICK_MS: u64 = 200;
const RACE_GRACE_MS: u64 = 1_800;
const RACE_HEAD_START_MS: u64 = 1_800;
const RACE_SETTLE_MS: u64 = 5_000;
const ALIVE_BYTES: u64 = 256 * 1024;
const PROBE_MAX: usize = 6;
const PROBE_MS: u64 = 6_000;
const TRACKERS_URL: &str =
    "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt";
const TRACKERS_MAX: usize = 40;
const TRACKERS_MAX_AGE_SECS: u64 = 24 * 60 * 60;

pub const DEFAULT_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://tracker.qu.ax:6969/announce",
    "udp://tracker-udp.gbitt.info:80/announce",
    "udp://tracker.tryhackx.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://tracker.gmi.gd:6969/announce",
    "http://tracker.renfei.net:8080/announce",
];

#[derive(Clone, Debug)]
pub struct TorrentFileEntry {
    pub name: String,
    pub length: u64,
}

#[derive(Clone, Debug, Default)]
pub struct FileHint {
    pub file_idx: Option<usize>,
    pub filename: String,
    pub season: u32,
    pub episode: u32,
}

#[derive(Clone, Debug)]
pub struct RaceCandidate {
    pub hash: String,
    pub file_idx: Option<usize>,
    pub sources: Vec<String>,
    pub filename: String,
    pub season: u32,
    pub episode: u32,
}

struct ActiveTorrent {
    key: String,
    hash: String,
    token: String,
    torrent_id: usize,
    handle: ManagedTorrentHandle,
    file_id: usize,
    file_name: String,
    file_length: u64,
    started: Instant,
    last_read_ms: Arc<AtomicU64>,
    // Sequential head + tail prefetch streams kept alive until the HTTP player connects.
    prefetch: Arc<Mutex<Vec<PrefetchGuard>>>,
}

struct RaceStatus {
    started: Instant,
    total_candidates: usize,
    handles: Vec<(usize, ManagedTorrentHandle)>,
    aborts: Vec<AbortHandle>,
}

#[derive(Clone)]
pub struct TorrentEngine {
    http: reqwest::Client,
    cache_dir: PathBuf,
    low_memory: bool,
    session: Arc<Mutex<Option<Arc<Session>>>>,
    active: Arc<RwLock<Option<ActiveTorrent>>>,
    racing: Arc<RwLock<Option<RaceStatus>>>,
    race_gen: Arc<AtomicU64>,
    fetched_trackers: Arc<RwLock<Vec<String>>>,
    trackers_checked: Arc<AtomicU64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn random_hex(bytes_len: usize) -> String {
    let mut buf = vec![0u8; bytes_len];
    rand::thread_rng().fill_bytes(&mut buf);
    let mut s = String::with_capacity(bytes_len * 2);
    for b in buf {
        use std::fmt::Write;
        let _ = write!(&mut s, "{b:02x}");
    }
    s
}

pub fn encode_path_segment(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 16);
    for &b in name.as_bytes() {
        let safe = b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~');
        if safe {
            out.push(b as char);
        } else {
            use std::fmt::Write;
            let _ = write!(&mut out, "%{b:02X}");
        }
    }
    out
}

pub fn is_video_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.rsplit('.').next().unwrap_or(""),
        "mp4" | "m4v" | "mkv" | "webm" | "avi" | "mov" | "ts" | "m2ts" | "wmv" | "flv" | "mpg" | "mpeg"
    )
}

pub fn mime_for_name(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" | "mov" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "ts" | "m2ts" => "video/mp2t",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mpg" | "mpeg" => "video/mpeg",
        _ => "application/octet-stream",
    }
}

pub fn parse_trackers(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        let lower = t.to_ascii_lowercase();
        let valid_scheme = lower.starts_with("udp://")
            || lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("ws://")
            || lower.starts_with("wss://");
        if valid_scheme && !t.contains(char::is_whitespace) && !out.iter().any(|x| x == t) {
            out.push(t.to_string());
            if out.len() >= TRACKERS_MAX {
                break;
            }
        }
    }
    out
}

fn base_name_lower(name: &str) -> String {
    name.rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase()
}

fn episode_regex(season: u32, episode: u32) -> Option<Regex> {
    if season == 0 || episode == 0 {
        return None;
    }
    let pat = format!(
        r"(?i)(?:^|[^0-9a-z])(?:s0*{season}[ ._-]*e0*{episode}|0*{season}x0*{episode})(?:$|[^0-9])"
    );
    Regex::new(&pat).ok()
}

/// Exact port of `service/torrents.js#pickFile`:
/// 1) explicit `file_idx`, 2) exact filename match among videos,
/// 3) SxxEyy / 1x05 regex match (largest matching video), 4) largest video.
pub fn pick_file(files: &[TorrentFileEntry], hint: &FileHint) -> Option<usize> {
    if let Some(idx) = hint.file_idx {
        if idx < files.len() {
            return Some(idx);
        }
    }
    let videos: Vec<(usize, &TorrentFileEntry)> = files
        .iter()
        .enumerate()
        .filter(|(_, f)| is_video_file(&f.name))
        .collect();
    if videos.is_empty() {
        return None;
    }

    let want = base_name_lower(&hint.filename);
    if !want.is_empty() {
        if let Some((idx, _)) = videos.iter().find(|(_, f)| base_name_lower(&f.name) == want) {
            return Some(*idx);
        }
    }

    if videos.len() > 1 {
        if let Some(re) = episode_regex(hint.season, hint.episode) {
            let best_ep = videos
                .iter()
                .filter(|(_, f)| re.is_match(&base_name_lower(&f.name)))
                .max_by_key(|(_, f)| f.length);
            if let Some((idx, _)) = best_ep {
                return Some(*idx);
            }
        }
    }

    videos.iter().max_by_key(|(_, f)| f.length).map(|(i, _)| *i)
}

pub fn is_valid_info_hash(hash: &str) -> bool {
    hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parse_optional_usize(v: &Value) -> Option<usize> {
    if let Some(n) = v.as_u64() {
        return Some(n as usize);
    }
    if let Some(s) = v.as_str() {
        if !s.trim().is_empty() {
            return s.trim().parse::<usize>().ok();
        }
    }
    None
}

fn parse_u32(v: &Value) -> u32 {
    if let Some(n) = v.as_u64() {
        return n as u32;
    }
    if let Some(s) = v.as_str() {
        return s.trim().parse::<u32>().unwrap_or(0);
    }
    0
}

fn parse_sources(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

pub fn candidates_from(opts: &Value, max_race: usize) -> Vec<RaceCandidate> {
    let season = parse_u32(&opts["season"]);
    let episode = parse_u32(&opts["episode"]);

    let mut raw_list: Vec<&Value> = vec![opts];
    if let Some(alts) = opts["alternatives"].as_array() {
        for a in alts {
            raw_list.push(a);
        }
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in raw_list {
        let hash = item["infoHash"].as_str().unwrap_or("").trim().to_ascii_lowercase();
        if !is_valid_info_hash(&hash) || !seen.insert(hash.clone()) {
            continue;
        }
        out.push(RaceCandidate {
            hash,
            file_idx: parse_optional_usize(&item["fileIdx"]),
            sources: parse_sources(&item["sources"]),
            filename: item["filename"].as_str().unwrap_or("").to_string(),
            season,
            episode,
        });
        if out.len() >= max_race {
            break;
        }
    }
    out
}

pub fn parse_range(header_val: Option<&str>, total: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(raw) = header_val else {
        return Ok(None);
    };
    let s = raw.trim();
    let Some(rest) = s.strip_prefix("bytes=") else {
        return Ok(None);
    };
    let part = rest.split(',').next().unwrap_or("").trim();
    let Some((a, b)) = part.split_once('-') else {
        return Ok(None);
    };
    if total == 0 {
        return Err(());
    }
    let (start, end) = if a.is_empty() && !b.is_empty() {
        let suffix = b.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        (total.saturating_sub(suffix), total - 1)
    } else {
        let s_pos = a.parse::<u64>().map_err(|_| ())?;
        let e_pos = if b.is_empty() {
            total - 1
        } else {
            b.parse::<u64>().map_err(|_| ())?.min(total - 1)
        };
        (s_pos, e_pos)
    };
    if start > end || start >= total {
        return Err(());
    }
    Ok(Some((start, end)))
}

/// Builds a `magnet:?xt=urn:btih:...` URI with every tracker URL-encoded as `&tr=`.
/// IMPORTANT: librqbit 9.1 ignores `AddTorrentOptions.trackers` for magnet links and
/// only reads trackers parsed from the magnet URI itself + `SessionOptions.trackers`.
pub fn build_magnet_uri(hash: &str, trackers: &[String]) -> String {
    let mut uri = format!("magnet:?xt=urn:btih:{hash}");
    for tr in trackers {
        let trimmed = tr.trim();
        if trimmed.is_empty() {
            continue;
        }
        let enc: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
        uri.push_str("&tr=");
        uri.push_str(&enc);
    }
    uri
}

fn default_peer_opts() -> PeerConnectionOptions {
    PeerConnectionOptions {
        connect_timeout: Some(Duration::from_secs(4)),
        read_write_timeout: Some(Duration::from_secs(10)),
        keep_alive_interval: Some(Duration::from_secs(30)),
        // 32 in-flight chunks per peer (512 KB/peer) keeps throughput saturated while
        // making seeks react 4x faster than librqbit's default 128-chunk window.
        max_request_window: Some(32),
    }
}

fn default_session_trackers() -> HashSet<url::Url> {
    DEFAULT_TRACKERS
        .iter()
        .filter_map(|s| url::Url::parse(s).ok())
        .collect()
}

/// Pins sequential piece prioritization at byte 0 (start of video, 32 MiB lookahead)
/// AND the last 2 MiB of the file (MP4 `moov` atom / MKV `Cues`) so playback starts
/// and seeks immediately as soon as the player connects.
async fn open_prefetch_streams(handle: &ManagedTorrentHandle, file_id: usize, file_length: u64) -> Vec<PrefetchGuard> {
    let mut streams: Vec<PrefetchGuard> = Vec::new();
    if let Ok(head) = handle.clone().stream(file_id).await {
        streams.push(Box::new(head));
    }
    if file_length > 4 * 1024 * 1024 {
        if let Ok(mut tail) = handle.clone().stream(file_id).await {
            let tail_pos = file_length.saturating_sub(2 * 1024 * 1024);
            if tail.seek(SeekFrom::Start(tail_pos)).await.is_ok() {
                streams.push(Box::new(tail));
            }
        }
    }
    streams
}

impl TorrentEngine {
    pub fn new(http: reqwest::Client, cache_root: PathBuf, low_memory: bool) -> Self {
        let cache_dir = cache_root.join("torrents");
        let engine = Self {
            http,
            cache_dir,
            low_memory,
            session: Arc::new(Mutex::new(None)),
            active: Arc::new(RwLock::new(None)),
            racing: Arc::new(RwLock::new(None)),
            race_gen: Arc::new(AtomicU64::new(0)),
            fetched_trackers: Arc::new(RwLock::new(Vec::new())),
            trackers_checked: Arc::new(AtomicU64::new(0)),
        };

        // Refresh public trackers list early so the very first torrent gets all 40+ trackers.
        engine.maybe_refresh_trackers();

        // Pre-warm DHT routing table in the background on desktop so the first torrent
        // click finds peers immediately without a cold 5-8s DHT bootstrap delay.
        if !low_memory {
            let warm_ref = engine.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(1200)).await;
                let _ = warm_ref.ensure_session().await;
            });
        }

        // Background idle reaper: stops streaming torrent after 10 min without reads.
        let idle_ref = engine.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let should_stop = {
                    let guard = idle_ref.active.read().await;
                    if let Some(ref cur) = *guard {
                        now_ms().saturating_sub(cur.last_read_ms.load(Ordering::Relaxed))
                            > IDLE_STOP_MS
                    } else {
                        false
                    }
                };
                if should_stop {
                    idle_ref.stop().await;
                }
            }
        });

        engine
    }

    pub fn cache_dir(&self) -> &PathBuf {
        &self.cache_dir
    }

    fn build_session_opts(&self, with_listener: bool, peer_limit: usize, init_limit: usize, persist_dht: bool) -> SessionOptions {
        let dht_persistence = if persist_dht {
            let dht_path = self
                .cache_dir
                .parent()
                .unwrap_or(&self.cache_dir)
                .join("opentv-dht.json");
            Some(DhtPersistenceConfig {
                dump_interval: Some(Duration::from_secs(60)),
                config_filename: Some(dht_path),
            })
        } else {
            None
        };
        let listen = if with_listener {
            Some(ListenerOptions {
                mode: ListenerMode::TcpAndUtp,
                listen_addr: SocketAddr::from(([0, 0, 0, 0], 0)),
                enable_upnp_port_forwarding: !self.low_memory,
                ipv4_only: true,
                ..Default::default()
            })
        } else {
            None
        };
        SessionOptions {
            dht: Some(DhtSessionConfig {
                bootstrap_addrs: None,
                port: None,
                persistence: dht_persistence,
            }),
            persistence: None,
            fastresume: false,
            listen,
            connect: Some(ConnectionOptions {
                enable_tcp: true,
                peer_opts: Some(default_peer_opts()),
                ..Default::default()
            }),
            trackers: default_session_trackers(),
            disable_local_service_discovery: true,
            ipv4_only: true,
            peer_limit: Some(peer_limit),
            concurrent_init_limit: Some(init_limit),
            client_name_and_version: Some(format!("OpenTV/{}", env!("CARGO_PKG_VERSION"))),
            ..Default::default()
        }
    }

    async fn ensure_session(&self) -> Result<Arc<Session>, String> {
        let mut guard = self.session.lock().await;
        if let Some(ref s) = *guard {
            return Ok(s.clone());
        }
        let _ = std::fs::create_dir_all(&self.cache_dir);
        let peer_limit = if self.low_memory { 44 } else { 128 };
        let init_limit = if self.low_memory { 3 } else { 10 };
        let opts = self.build_session_opts(true, peer_limit, init_limit, true);
        let sess = match Session::new_with_opts(self.cache_dir.clone(), opts).await {
            Ok(s) => s,
            Err(_) => {
                // Fallback without incoming TCP/uTP listener if restricted by OS/firewall.
                let fallback = self.build_session_opts(false, peer_limit, init_limit, true);
                Session::new_with_opts(self.cache_dir.clone(), fallback)
                    .await
                    .map_err(|e| format!("No se pudo iniciar el motor de torrents: {e}"))?
            }
        };
        *guard = Some(sess.clone());
        Ok(sess)
    }

    pub async fn create_dedicated_session(&self, dir: PathBuf) -> Result<Arc<Session>, String> {
        let _ = std::fs::create_dir_all(&dir);
        let peer_limit = if self.low_memory { 36 } else { 80 };
        let opts = self.build_session_opts(true, peer_limit, 4, false);
        match Session::new_with_opts(dir.clone(), opts).await {
            Ok(s) => Ok(s),
            Err(_) => {
                let fallback = self.build_session_opts(false, peer_limit, 4, false);
                Session::new_with_opts(dir, fallback)
                    .await
                    .map_err(|e| format!("No se pudo iniciar descarga torrent: {e}"))
            }
        }
    }

    pub async fn build_trackers(&self, sources: &[String]) -> Vec<String> {
        self.maybe_refresh_trackers();
        let mut list: Vec<String> = DEFAULT_TRACKERS.iter().map(|s| s.to_string()).collect();
        {
            let fetched = self.fetched_trackers.read().await;
            for t in fetched.iter() {
                if !list.iter().any(|x| x == t) {
                    list.push(t.clone());
                }
            }
        }
        for s in sources {
            let trimmed = s.trim();
            if let Some(tr) = trimmed
                .strip_prefix("tracker:")
                .or_else(|| trimmed.strip_prefix("TRACKER:"))
            {
                let tr = tr.trim();
                if !tr.is_empty() && !list.iter().any(|x| x == tr) {
                    list.push(tr.to_string());
                }
            }
        }
        list
    }

    fn maybe_refresh_trackers(&self) {
        let now = now_ms();
        let prev = self.trackers_checked.load(Ordering::Relaxed);
        if now.saturating_sub(prev) < 60 * 60 * 1000 {
            return;
        }
        self.trackers_checked.store(now, Ordering::Relaxed);

        let trackers_file = self
            .cache_dir
            .parent()
            .unwrap_or(&self.cache_dir)
            .join("opentv-trackers.txt");
        let http = self.http.clone();
        let store = self.fetched_trackers.clone();

        tokio::spawn(async move {
            if let Ok(meta) = tokio::fs::metadata(&trackers_file).await {
                if let Ok(mtime) = meta.modified() {
                    if let Ok(age) = SystemTime::now().duration_since(mtime) {
                        if let Ok(text) = tokio::fs::read_to_string(&trackers_file).await {
                            let parsed = parse_trackers(&text);
                            if !parsed.is_empty() {
                                *store.write().await = parsed;
                                if age.as_secs() < TRACKERS_MAX_AGE_SECS {
                                    return;
                                }
                            }
                        }
                    }
                }
            }

            if let Ok(resp) = http
                .get(TRACKERS_URL)
                .timeout(Duration::from_secs(10))
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(body) = resp.text().await {
                        let parsed = parse_trackers(&body);
                        if !parsed.is_empty() {
                            let _ = tokio::fs::write(&trackers_file, parsed.join("\n") + "\n").await;
                            *store.write().await = parsed;
                        }
                    }
                }
            }
        });
    }

    pub async fn start(&self, base_url: &str, opts: &Value) -> Result<Value, String> {
        let max_race = if self.low_memory { 2 } else { 4 };
        let cands = candidates_from(opts, max_race);
        let main_hash = opts["infoHash"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if cands.is_empty() || cands[0].hash != main_hash {
            return Err("El torrent no es válido".to_string());
        }

        let key = format!(
            "{}:{}",
            cands[0].hash,
            cands[0]
                .file_idx
                .map(|i| i.to_string())
                .unwrap_or_default()
        );

        // Reuse already playing torrent if exact same key.
        {
            let active = self.active.read().await;
            if let Some(ref cur) = *active {
                if cur.key == key {
                    return Ok(describe_active(base_url, cur));
                }
            }
        }

        // Cancel previous torrent/race.
        self.stop().await;
        let my_gen = self.race_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let session = self.ensure_session().await?;

        struct RaceJob {
            cand: RaceCandidate,
            torrent_id: Option<usize>,
            handle: Option<ManagedTorrentHandle>,
            selected_file: Option<(usize, String, u64)>,
            prefetch: Vec<PrefetchGuard>,
            failed: Option<String>,
            was_alive: bool,
        }

        let mut jobs: Vec<RaceJob> = cands
            .into_iter()
            .map(|cand| RaceJob {
                cand,
                torrent_id: None,
                handle: None,
                selected_file: None,
                prefetch: Vec::new(),
                failed: None,
                was_alive: false,
            })
            .collect();

        // Spawn ALL candidates concurrently! librqbit's `add_torrent` awaits magnet
        // metadata resolution, so calling it sequentially in a loop previously blocked
        // forever on a slow/dead first candidate and prevented the source race entirely.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(usize, Result<ManagedTorrentHandle, String>)>();
        let mut aborts: Vec<AbortHandle> = Vec::with_capacity(jobs.len());
        let peer_limit = Some(if self.low_memory { 32 } else { 88 });
        let peer_opts = Some(default_peer_opts());

        for (idx, job) in jobs.iter().enumerate() {
            let trackers = self.build_trackers(&job.cand.sources).await;
            let magnet = build_magnet_uri(&job.cand.hash, &trackers);
            let sub_folder = format!("stream-{}-{}", &job.cand.hash[..8], random_hex(4));
            let add_opts = AddTorrentOptions {
                overwrite: true,
                paused: false,
                sub_folder: Some(sub_folder),
                trackers: Some(trackers),
                peer_limit,
                peer_opts: peer_opts.clone(),
                ..Default::default()
            };
            let sess_c = session.clone();
            let tx_c = tx.clone();
            let gen_c = self.race_gen.clone();
            let jh = tokio::spawn(async move {
                let res = match sess_c
                    .add_torrent(AddTorrent::from_url(magnet), Some(add_opts))
                    .await
                {
                    Ok(resp) => match resp.into_handle() {
                        Some(h) => {
                            if gen_c.load(Ordering::SeqCst) != my_gen {
                                let _ = sess_c.delete(TorrentIdOrHash::Id(h.id()), true).await;
                                return;
                            }
                            Ok(h)
                        }
                        None => Err("No se pudo abrir el torrent".to_string()),
                    },
                    Err(e) => Err(format!("No se pudo abrir el torrent: {e}")),
                };
                if let Err(tokio::sync::mpsc::error::SendError((_, Ok(h)))) = tx_c.send((idx, res)) {
                    // Race already finished while we resolved; delete cleanly.
                    let _ = sess_c.delete(TorrentIdOrHash::Id(h.id()), true).await;
                }
            });
            aborts.push(jh.abort_handle());
        }
        drop(tx);

        let started = Instant::now();
        {
            let mut r = self.racing.write().await;
            *r = Some(RaceStatus {
                started,
                total_candidates: jobs.len(),
                handles: Vec::new(),
                aborts: aborts.clone(),
            });
        }

        let mut first_alive_at: Option<Instant> = None;
        let mut winner_idx: Option<usize> = None;
        let mut race_err: Option<String> = None;

        loop {
            if self.race_gen.load(Ordering::SeqCst) != my_gen {
                race_err = Some("Se canceló la carga del torrent".to_string());
                break;
            }

            // Drain any candidates whose magnet metadata just arrived.
            while let Ok((idx, outcome)) = rx.try_recv() {
                if let Some(job) = jobs.get_mut(idx) {
                    match outcome {
                        Ok(handle) => {
                            let tid = handle.id();
                            job.torrent_id = Some(tid);
                            job.handle = Some(handle.clone());
                            if let Some(ref mut r) = *self.racing.write().await {
                                r.handles.push((tid, handle));
                            }
                        }
                        Err(msg) => {
                            job.failed = Some(msg);
                        }
                    }
                }
            }

            let elapsed_ms = started.elapsed().as_millis() as u64;
            let mut alive_idx: Option<usize> = None;
            let mut meta_idx: Option<usize> = None;
            let mut failed_count: usize = 0;

            for (i, job) in jobs.iter_mut().enumerate() {
                if job.failed.is_some() {
                    failed_count += 1;
                    continue;
                }
                let Some(ref handle) = job.handle else {
                    continue;
                };

                // Resolve target video file once metadata arrives and pin head+tail sequential streams.
                if job.selected_file.is_none() {
                    let meta_files = handle.with_metadata(|m| {
                        m.file_infos
                            .iter()
                            .map(|fi| TorrentFileEntry {
                                name: fi.relative_filename.to_string_lossy().to_string(),
                                length: fi.len,
                            })
                            .collect::<Vec<_>>()
                    });

                    if let Ok(files) = meta_files {
                        let hint = FileHint {
                            file_idx: job.cand.file_idx,
                            filename: job.cand.filename.clone(),
                            season: job.cand.season,
                            episode: job.cand.episode,
                        };
                        match pick_file(&files, &hint) {
                            Some(fid) => {
                                let entry = &files[fid];
                                let mut only = HashSet::new();
                                only.insert(fid);
                                let _ = session.update_only_files(handle, &only).await;
                                job.prefetch = open_prefetch_streams(handle, fid, entry.length).await;
                                job.selected_file = Some((fid, entry.name.clone(), entry.length));
                            }
                            None => {
                                job.failed = Some("El torrent no tiene ningún vídeo".to_string());
                                failed_count += 1;
                                continue;
                            }
                        }
                    }
                }

                if job.selected_file.is_some() && meta_idx.is_none() {
                    meta_idx = Some(i);
                }

                if job.selected_file.is_some() && !job.was_alive {
                    let st = handle.stats();
                    if st.error.is_some() {
                        job.failed = st.error.clone();
                        failed_count += 1;
                        continue;
                    }
                    let (live_peers, seeders, fetched) = st
                        .live
                        .as_ref()
                        .map(|l| {
                            (
                                l.snapshot.peer_stats.live,
                                l.snapshot.peer_stats.live_seeders,
                                l.snapshot.fetched_bytes.max(st.progress_bytes),
                            )
                        })
                        .unwrap_or((0, 0, st.progress_bytes));
                    if st.finished || seeders >= 1 || fetched >= ALIVE_BYTES || (live_peers >= 2 && fetched >= 128 * 1024) {
                        job.was_alive = true;
                    }
                }

                if alive_idx.is_none() && job.was_alive {
                    alive_idx = Some(i);
                }
            }

            if jobs.len() == 1 && meta_idx == Some(0) {
                winner_idx = Some(0);
                break;
            }
            if alive_idx == Some(0) {
                winner_idx = Some(0);
                break;
            }
            if let Some(a_idx) = alive_idx {
                let mut hope = elapsed_ms < RACE_HEAD_START_MS && jobs[0].failed.is_none();
                for b in 0..a_idx {
                    if jobs[b].failed.is_none() && jobs[b].selected_file.is_some() {
                        hope = true;
                    }
                }
                let fa = *first_alive_at.get_or_insert_with(Instant::now);
                if !hope || fa.elapsed().as_millis() as u64 >= RACE_GRACE_MS {
                    winner_idx = Some(a_idx);
                    break;
                }
            }

            if failed_count == jobs.len() {
                race_err = Some(
                    jobs[0]
                        .failed
                        .clone()
                        .unwrap_or_else(|| "No se pudo abrir el torrent".to_string()),
                );
                break;
            }

            if let Some(m_idx) = meta_idx {
                if elapsed_ms >= RACE_SETTLE_MS {
                    winner_idx = Some(m_idx);
                    break;
                }
            }

            if elapsed_ms >= READY_TIMEOUT_MS {
                race_err = Some(
                    "No se encontraron fuentes para este torrent. Prueba con otra fuente."
                        .to_string(),
                );
                break;
            }

            tokio::time::sleep(Duration::from_millis(RACE_TICK_MS)).await;
        }

        // Abort any still-pending `add_torrent` tasks and clear racing state.
        for ah in aborts {
            ah.abort();
        }
        *self.racing.write().await = None;

        // Drain any handles that arrived right as the loop ended so nothing leaks.
        while let Ok((idx, outcome)) = rx.try_recv() {
            if let Ok(h) = outcome {
                if let Some(job) = jobs.get_mut(idx) {
                    if job.torrent_id.is_none() {
                        job.torrent_id = Some(h.id());
                        job.handle = Some(h);
                    }
                }
            }
        }

        // Clean up losing jobs.
        let mut chosen: Option<RaceJob> = None;
        for (i, mut job) in jobs.into_iter().enumerate() {
            if winner_idx == Some(i) && race_err.is_none() {
                chosen = Some(job);
            } else {
                job.prefetch.clear();
                if let Some(tid) = job.torrent_id {
                    let _ = session.delete(TorrentIdOrHash::Id(tid), true).await;
                }
            }
        }

        if let Some(err) = race_err {
            return Err(err);
        }

        let winner = chosen.ok_or_else(|| "No se pudo iniciar el torrent".to_string())?;
        let winner_tid = winner
            .torrent_id
            .ok_or_else(|| "No se pudo iniciar el torrent".to_string())?;
        let winner_handle = winner
            .handle
            .ok_or_else(|| "No se pudo iniciar el torrent".to_string())?;
        let (file_id, file_name, file_length) = winner
            .selected_file
            .ok_or_else(|| "El torrent no tiene ningún vídeo".to_string())?;

        let prefetch = Arc::new(Mutex::new(winner.prefetch));
        // Auto-release prefetch streams after 15s even if the player never reads,
        // so normal streaming/seeking never keeps extra handles pinned forever.
        let prefetch_drop = prefetch.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(15)).await;
            prefetch_drop.lock().await.clear();
        });

        let active = ActiveTorrent {
            key,
            hash: winner.cand.hash,
            token: random_hex(8),
            torrent_id: winner_tid,
            handle: winner_handle,
            file_id,
            file_name,
            file_length,
            started,
            last_read_ms: Arc::new(AtomicU64::new(now_ms())),
            prefetch,
        };
        let out = describe_active(base_url, &active);
        *self.active.write().await = Some(active);
        Ok(out)
    }

    pub async fn stats(&self) -> Value {
        if let Some(ref cur) = *self.active.read().await {
            let st = cur.handle.stats();
            let (peers, speed, upload, seeders) = if let Some(ref live) = st.live {
                (
                    live.snapshot.peer_stats.live,
                    live.download_speed.as_bytes(),
                    live.upload_speed.as_bytes(),
                    live.snapshot.peer_stats.live_seeders,
                )
            } else {
                (0, 0, 0, 0)
            };
            let available: i64 = if st.finished || seeders > 0 {
                100
            } else if cur.file_length > 0 {
                ((st.progress_bytes as f64 / cur.file_length as f64).min(1.0) * 100.0).round() as i64
            } else {
                0
            };
            return json!({
                "active": true,
                "ready": true,
                "racing": 0,
                "name": cur.file_name,
                "length": cur.file_length,
                "peers": peers,
                "speed": speed,
                "upload": upload,
                "downloaded": st.progress_bytes,
                "available": available,
                "seconds": cur.started.elapsed().as_secs()
            });
        }

        if let Some(ref r) = *self.racing.read().await {
            let mut peers = 0u32;
            let mut speed = 0u64;
            let mut downloaded = 0u64;
            let mut best_avail = 0i64;
            for (_, h) in &r.handles {
                let st = h.stats();
                downloaded = downloaded.max(st.progress_bytes);
                if let Some(ref live) = st.live {
                    peers = peers.max(live.snapshot.peer_stats.live);
                    speed = speed.max(live.download_speed.as_bytes());
                    if st.finished || live.snapshot.peer_stats.live_seeders > 0 {
                        best_avail = 100;
                    }
                }
            }
            return json!({
                "active": true,
                "ready": false,
                "racing": r.total_candidates,
                "name": "",
                "length": 0,
                "peers": peers,
                "speed": speed,
                "upload": 0,
                "downloaded": downloaded,
                "available": best_avail,
                "seconds": r.started.elapsed().as_secs()
            });
        }

        json!({ "active": false })
    }

    pub async fn probe(&self, opts: &Value) -> Value {
        if self.low_memory {
            return json!({ "results": {} });
        }
        let active_hash = self
            .active
            .read()
            .await
            .as_ref()
            .map(|a| a.hash.clone())
            .unwrap_or_default();

        let mut list: Vec<(String, Vec<String>)> = Vec::new();
        let mut seen = HashSet::new();
        if let Some(arr) = opts["torrents"].as_array() {
            for t in arr {
                let hash = t["infoHash"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase();
                if !is_valid_info_hash(&hash) || hash == active_hash || !seen.insert(hash.clone())
                {
                    continue;
                }
                list.push((hash, parse_sources(&t["sources"])));
                if list.len() >= PROBE_MAX {
                    break;
                }
            }
        }

        if list.is_empty() {
            return json!({ "results": {} });
        }

        let Ok(session) = self.ensure_session().await else {
            return json!({ "results": {} });
        };

        // Probe all candidates concurrently with a strict deadline so detail pages never stall.
        let mut tasks = Vec::with_capacity(list.len());
        let deadline = Duration::from_millis(PROBE_MS);
        for (hash, sources) in list {
            let trackers = self.build_trackers(&sources).await;
            let magnet = build_magnet_uri(&hash, &trackers);
            let sess_c = session.clone();
            tasks.push(tokio::spawn(async move {
                let add_opts = AddTorrentOptions {
                    overwrite: true,
                    paused: false,
                    only_files: Some(Vec::new()),
                    sub_folder: Some(format!("probe-{}-{}", &hash[..8], random_hex(3))),
                    trackers: Some(trackers),
                    peer_limit: Some(24),
                    peer_opts: Some(default_peer_opts()),
                    ..Default::default()
                };
                let added = tokio::time::timeout(
                    deadline,
                    sess_c.add_torrent(AddTorrent::from_url(magnet), Some(add_opts)),
                )
                .await;
                let Ok(Ok(resp)) = added else {
                    return (hash, 0u32, -1i64);
                };
                let Some(h) = resp.into_handle() else {
                    return (hash, 0u32, -1i64);
                };
                let tid = h.id();
                tokio::time::sleep(Duration::from_millis(1200)).await;
                let st = h.stats();
                let (peers, seeders) = st
                    .live
                    .as_ref()
                    .map(|l| (l.snapshot.peer_stats.live, l.snapshot.peer_stats.live_seeders))
                    .unwrap_or((0, 0));
                let available = if seeders > 0 {
                    100
                } else if peers > 0 {
                    50
                } else {
                    -1
                };
                let _ = sess_c.delete(TorrentIdOrHash::Id(tid), true).await;
                (hash, peers, available)
            }));
        }

        let mut results = serde_json::Map::new();
        for task in tasks {
            if let Ok((hash, peers, available)) = task.await {
                results.insert(
                    hash,
                    json!({
                        "peers": peers,
                        "available": available
                    }),
                );
            }
        }

        json!({ "results": Value::Object(results) })
    }

    pub async fn stop(&self) {
        self.race_gen.fetch_add(1, Ordering::SeqCst);

        let prev_active = self.active.write().await.take();
        let prev_race = self.racing.write().await.take();

        if let Some(ref r) = prev_race {
            for ah in &r.aborts {
                ah.abort();
            }
        }

        if prev_active.is_none() && prev_race.is_none() {
            return;
        }

        if let Some(session) = self.session.lock().await.clone() {
            if let Some(a) = prev_active {
                a.prefetch.lock().await.clear();
                let _ = session
                    .delete(TorrentIdOrHash::Id(a.torrent_id), true)
                    .await;
            }
            if let Some(r) = prev_race {
                for (tid, _) in r.handles {
                    let _ = session.delete(TorrentIdOrHash::Id(tid), true).await;
                }
            }
        }
    }

    pub async fn serve_torrent(
        &self,
        method: &Method,
        token: &str,
        req_headers: &HeaderMap,
    ) -> Response {
        let (handle, file_id, file_name, total, last_read_ms, prefetch) = {
            let guard = self.active.read().await;
            let Some(ref cur) = *guard else {
                return (StatusCode::NOT_FOUND, "Not found").into_response();
            };
            if cur.token != token {
                return (StatusCode::NOT_FOUND, "Not found").into_response();
            }
            (
                cur.handle.clone(),
                cur.file_id,
                cur.file_name.clone(),
                cur.file_length,
                cur.last_read_ms.clone(),
                cur.prefetch.clone(),
            )
        };

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
            .header(header::CONTENT_TYPE, mime_for_name(&file_name))
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

        // Player connected: hand over sequential piece priority cleanly to the live stream.
        if start > 0 {
            prefetch.lock().await.clear();
        }

        let mut file_stream = match handle.stream(file_id).await {
            Ok(s) => s,
            Err(e) => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("Torrent stream unavailable: {e}"),
                )
                    .into_response();
            }
        };

        if start > 0 {
            if let Err(e) = file_stream.seek(SeekFrom::Start(start)).await {
                return (StatusCode::BAD_GATEWAY, format!("Seek error: {e}")).into_response();
            }
        }

        last_read_ms.store(now_ms(), Ordering::Relaxed);
        let chunk_size = if self.low_memory { 128 * 1024 } else { 256 * 1024 };
        let limited = file_stream.take(len);
        let reader_stream = stream::unfold(
            (limited, vec![0u8; chunk_size], last_read_ms),
            |(mut rdr, mut buf, lr)| async move {
                match rdr.read(&mut buf).await {
                    Ok(0) => None,
                    Ok(n) => {
                        lr.store(now_ms(), Ordering::Relaxed);
                        let chunk = Bytes::copy_from_slice(&buf[..n]);
                        Some((Ok::<Bytes, std::io::Error>(chunk), (rdr, buf, lr)))
                    }
                    Err(e) => Some((Err(e), (rdr, buf, lr))),
                }
            },
        );

        builder
            .body(Body::from_stream(reader_stream))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    }
}

fn describe_active(base_url: &str, cur: &ActiveTorrent) -> Value {
    json!({
        "url": format!("{}/t/{}/{}", base_url, cur.token, encode_path_segment(&cur.file_name)),
        "name": cur.file_name,
        "length": cur.file_length,
        "mime": mime_for_name(&cur.file_name),
        "infoHash": cur.hash
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_lists_and_candidates_match_contract() {
        let parsed = parse_trackers(
            "udp://a.org:1/announce\n\nnot a tracker\nhttp://b.org/announce\r\nudp://a.org:1/announce\nfile:///etc/passwd",
        );
        assert_eq!(
            parsed,
            vec![
                "udp://a.org:1/announce".to_string(),
                "http://b.org/announce".to_string()
            ]
        );

        let h = |c: &str| c.repeat(40);
        let opts = json!({
            "infoHash": h("a"),
            "alternatives": [
                { "infoHash": h("a") },
                { "infoHash": "xyz" },
                { "infoHash": h("b") },
                { "infoHash": h("c") },
                { "infoHash": h("d") },
                { "infoHash": h("e") }
            ]
        });
        let cands = candidates_from(&opts, 4);
        let first_chars: Vec<String> = cands
            .iter()
            .map(|c| c.hash.chars().next().unwrap().to_string())
            .collect();
        assert_eq!(first_chars, vec!["a", "b", "c", "d"]);
    }

    #[test]
    fn pick_file_selects_episode_in_season_pack() {
        let files = vec![
            TorrentFileEntry {
                name: "Show.S01E01.1080p.mkv".into(),
                length: 900,
            },
            TorrentFileEntry {
                name: "Show.S01E02.1080p.mkv".into(),
                length: 1500,
            },
            TorrentFileEntry {
                name: "Show.S01E10.1080p.mkv".into(),
                length: 800,
            },
            TorrentFileEntry {
                name: "Show.S01E10.sample.mkv".into(),
                length: 50,
            },
            TorrentFileEntry {
                name: "notes.txt".into(),
                length: 5,
            },
        ];

        assert_eq!(
            pick_file(
                &files,
                &FileHint {
                    file_idx: Some(0),
                    ..Default::default()
                }
            ),
            Some(0)
        );
        assert_eq!(
            pick_file(
                &files,
                &FileHint {
                    filename: "Pack/Show.S01E01.1080p.mkv".into(),
                    ..Default::default()
                }
            ),
            Some(0)
        );
        assert_eq!(
            pick_file(
                &files,
                &FileHint {
                    season: 1,
                    episode: 10,
                    ..Default::default()
                }
            ),
            Some(2)
        );
        assert_eq!(
            pick_file(
                &files,
                &FileHint {
                    season: 1,
                    episode: 1,
                    ..Default::default()
                }
            ),
            Some(0)
        );
        let alt = vec![
            TorrentFileEntry {
                name: "show.1x02.avi".into(),
                length: 1,
            },
            TorrentFileEntry {
                name: "show.1x03.avi".into(),
                length: 9,
            },
        ];
        assert_eq!(
            pick_file(
                &alt,
                &FileHint {
                    season: 1,
                    episode: 2,
                    ..Default::default()
                }
            ),
            Some(0)
        );
        // Film fallback: biggest video.
        assert_eq!(pick_file(&files, &FileHint::default()), Some(1));
    }

    #[test]
    fn magnet_uri_encodes_trackers_for_librqbit() {
        let hash = "08ada5a7a6183aae1e09d831df6748d566095a10";
        let trackers = vec![
            "udp://tracker.opentrackr.org:1337/announce".to_string(),
            "http://tracker.renfei.net:8080/announce".to_string(),
        ];
        let uri = build_magnet_uri(hash, &trackers);
        assert!(uri.starts_with(&format!("magnet:?xt=urn:btih:{hash}&tr=")));
        assert!(uri.contains("tracker.opentrackr.org%3A1337%2Fannounce"));
        assert!(uri.contains("tracker.renfei.net%3A8080%2Fannounce"));
    }
}
