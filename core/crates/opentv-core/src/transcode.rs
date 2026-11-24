use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;
use bytes::Bytes;
use futures_util::stream;
use rand::RngCore;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, OnceCell, RwLock};
use url::Url;

use crate::netguard;
use crate::proxy::ProxyStore;

const MAX_COMPAT_SESSIONS: usize = 12;
const MAX_SUB_CACHE: usize = 32;
const MAX_SUB_BYTES: usize = 4 * 1024 * 1024;
const PROBE_TIMEOUT_SECS: u64 = 12;
const SUB_EXTRACT_TIMEOUT_SECS: u64 = 25;

/// Protocols FFmpeg may open. Every FFmpeg input is a loopback URL served by this
/// service (`/media`, `/hls`, `/t`, `/d`, `/local`): remote sources are always routed
/// through the NetGuard-checked, TLS-verifying `/media/{token}` proxy, so FFmpeg never
/// needs `https`/`tls`, and `file`, `concat`, `subfile`, `data`, `rtmp`, ... stay off.
/// `crypto` is required for AES-128 HLS segments (`crypto+http://...`).
pub const FFMPEG_PROTOCOL_WHITELIST: &str = "http,tcp,crypto";

/// Paths of this service that FFmpeg may read from.
const OWN_MEDIA_PREFIXES: &[&str] = &["/media/", "/hls/", "/t/", "/d/", "/local/"];

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioTrackInfo {
    pub index: usize,
    pub codec: String,
    pub lang: String,
    pub title: String,
    pub channels: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubtitleTrackInfo {
    pub index: usize,
    pub codec: String,
    pub lang: String,
    pub title: String,
    pub label: String,
    #[serde(rename = "textBased")]
    pub text_based: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProbeResult {
    #[serde(rename = "durationSec")]
    pub duration_sec: f64,
    pub container: String,
    #[serde(rename = "videoCodec")]
    pub video_codec: String,
    #[serde(rename = "videoPixFmt")]
    pub video_pix_fmt: String,
    #[serde(rename = "tenBit")]
    pub ten_bit: bool,
    #[serde(rename = "audioTracks")]
    pub audio_tracks: Vec<AudioTrackInfo>,
    #[serde(rename = "subtitleTracks")]
    pub subtitle_tracks: Vec<SubtitleTrackInfo>,
    pub recommendation: String, // "native" | "videoCopy" | "transcode"
}

#[derive(Clone, Debug)]
struct CompatSession {
    url: String,
    headers: HashMap<String, String>,
    hevc: bool,
}

#[derive(Clone)]
pub struct MediaCompatEngine {
    ffmpeg_path: Option<PathBuf>,
    hw_encoder: Arc<OnceCell<String>>,
    sessions: Arc<RwLock<HashMap<String, CompatSession>>>,
    session_order: Arc<RwLock<VecDeque<String>>>,
    sub_cache: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    sub_order: Arc<RwLock<VecDeque<String>>>,
    proxy: ProxyStore,
    active_child: Arc<Mutex<Option<u32>>>,
    active_kill_tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

fn rand_hex(len: usize) -> String {
    let mut b = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut b);
    let mut out = String::with_capacity(len * 2);
    for byte in b {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn validate_media_url(raw: &str) -> Result<Url, String> {
    let clean = raw.trim();
    if clean.is_empty() || clean.len() > 8192 || clean.chars().any(|c| c.is_control()) {
        return Err("Enlace multimedia no válido".to_string());
    }
    let parsed = Url::parse(clean).map_err(|_| "Enlace multimedia no válido".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Solo se permiten enlaces http/https".to_string());
    }
    Ok(parsed)
}

/// Returns `Some(url)` when `url` points at this service itself (allowed only for its
/// media routes), `None` when it is a remote URL, and an error for any other loopback
/// target (another local port, the RPC routes, other loopback addresses...).
fn own_service_input(base_url: &str, url: &Url) -> Result<Option<Url>, String> {
    let host = url.host_str().unwrap_or("");
    let is_loopback = netguard::classify_str(host) == Some("loopback");
    if !is_loopback {
        return Ok(None);
    }
    let base = Url::parse(base_url).map_err(|_| "Servicio no disponible".to_string())?;
    let same_port = url.port_or_known_default() == base.port_or_known_default();
    let host_ok = matches!(host.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost");
    let path_ok = OWN_MEDIA_PREFIXES.iter().any(|p| url.path().starts_with(p))
        && !url.path().contains("/../");
    if url.scheme() == "http" && same_port && host_ok && path_ok {
        Ok(Some(url.clone()))
    } else {
        Err(netguard::refusal_message(netguard::IpKind::Loopback).to_string())
    }
}

/// File name used for the `/media/{token}/<name>` path so the proxy (and FFmpeg)
/// can still tell an HLS playlist from a progressive file.
fn proxy_file_name(url: &Url) -> String {
    let last = url.path().rsplit('/').next().unwrap_or("");
    let ext = last
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(
        ext.as_str(),
        "mp4" | "m4v" | "mkv" | "webm" | "avi" | "mov" | "ts" | "m2ts" | "m3u8" | "mpd"
    ) {
        format!("stream.{ext}")
    } else {
        "stream".to_string()
    }
}

/// Only the FFmpeg shipped with the app is ever executed: `<exe dir>/resources/bin`
/// (Tauri bundle layout). Debug builds also accept `OPENTV_FFMPEG_PATH` and the
/// repository dev layout `apps/desktop/src-tauri/resources/bin`. Never the current
/// directory, the user profile, `C:\bin` or `PATH` (binary planting).
#[cfg(not(target_os = "android"))]
fn locate_ffmpeg() -> Option<PathBuf> {
    let bin_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    ffmpeg_candidates(bin_name).into_iter().find(|p| p.is_file())
}

#[cfg(not(target_os = "android"))]
fn ffmpeg_candidates(bin_name: &str) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(debug_assertions)]
    if let Ok(env_path) = std::env::var("OPENTV_FFMPEG_PATH") {
        candidates.push(PathBuf::from(env_path.trim()));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("bin").join(bin_name));
            #[cfg(debug_assertions)]
            for anc in dir.ancestors().take(7) {
                candidates.push(
                    anc.join("apps")
                        .join("desktop")
                        .join("src-tauri")
                        .join("resources")
                        .join("bin")
                        .join(bin_name),
                );
            }
        }
    }
    candidates
}

#[cfg(target_os = "android")]
fn locate_ffmpeg() -> Option<PathBuf> {
    None
}

fn configure_cmd(ffmpeg: &Path) -> Command {
    let mut cmd = Command::new(ffmpeg);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.kill_on_drop(true);
    cmd
}

fn split_ffmpeg_headers(headers: &HashMap<String, String>) -> (Option<String>, String) {
    let mut ua: Option<String> = None;
    let mut rest = String::new();
    for (k, v) in headers {
        let key = k.trim();
        let val = v.trim();
        if key.is_empty()
            || val.is_empty()
            || key.chars().any(|c| c == '\r' || c == '\n')
            || val.chars().any(|c| c == '\r' || c == '\n')
        {
            continue;
        }
        if key.eq_ignore_ascii_case("user-agent") {
            ua = Some(val.to_string());
        } else {
            rest.push_str(key);
            rest.push_str(": ");
            rest.push_str(val);
            rest.push_str("\r\n");
        }
    }
    (ua, rest)
}

/// Input options shared by every FFmpeg run (probe, compat relay, subtitle extraction).
/// `url` must already be a loopback URL of this service (see `prepare_input`).
fn push_input_args(args: &mut Vec<String>, url: &Url, headers: &HashMap<String, String>) {
    args.extend([
        "-hide_banner".into(),
        "-loglevel".into(),
        "info".into(),
        "-nostdin".into(),
        "-protocol_whitelist".into(),
        FFMPEG_PROTOCOL_WHITELIST.into(),
        "-probesize".into(),
        "3M".into(),
        "-analyzeduration".into(),
        "4M".into(),
    ]);
    if url.scheme() == "http" {
        args.extend(["-rw_timeout".into(), "15000000".into()]);
        let (ua, rest) = split_ffmpeg_headers(headers);
        if let Some(u) = ua {
            args.extend(["-user_agent".into(), u]);
        }
        if !rest.is_empty() {
            args.extend(["-headers".into(), rest]);
        }
    }
}

fn lang_display_es(code: &str) -> String {
    let c = code.trim().to_ascii_lowercase();
    match c.as_str() {
        "spa" | "es" | "es-la" | "es-mx" | "es-es" | "lat" => "Español".into(),
        "eng" | "en" | "en-us" | "en-gb" => "Inglés".into(),
        "por" | "pt" | "pt-br" => "Portugués".into(),
        "jpn" | "ja" => "Japonés".into(),
        "fre" | "fra" | "fr" => "Francés".into(),
        "ger" | "deu" | "de" => "Alemán".into(),
        "ita" | "it" => "Italiano".into(),
        "kor" | "ko" => "Coreano".into(),
        "chi" | "zho" | "zh" => "Chino".into(),
        "rus" | "ru" => "Ruso".into(),
        "und" | "" => String::new(),
        other => other.to_ascii_uppercase(),
    }
}

fn is_browser_safe_video(codec: &str, ten_bit: bool) -> bool {
    if ten_bit {
        return false;
    }
    matches!(codec, "h264" | "avc1" | "vp8" | "vp9" | "av1")
}

fn is_browser_safe_audio(codec: &str) -> bool {
    matches!(codec, "aac" | "mp3" | "opus" | "vorbis")
}

fn is_browser_safe_container(container: &str) -> bool {
    let c = container.to_ascii_lowercase();
    c.contains("mp4") || c.contains("mov") || c.contains("m4a") || c.contains("hls")
}

fn is_text_subtitle_codec(codec: &str) -> bool {
    matches!(
        codec.to_ascii_lowercase().as_str(),
        "subrip" | "srt" | "ass" | "ssa" | "webvtt" | "mov_text" | "text" | "smi" | "vplayer"
    )
}

/// Parses `ffmpeg -i <url>` stderr output into structured duration, codecs, multi-audio and subtitle tracks.
pub fn parse_ffmpeg_probe(stderr: &str) -> ProbeResult {
    let mut duration_sec = 0.0;
    let mut container = String::new();
    let mut video_codec = String::new();
    let mut video_pix_fmt = String::new();
    let mut ten_bit = false;
    let mut audio_tracks: Vec<AudioTrackInfo> = Vec::new();
    let mut subtitle_tracks: Vec<SubtitleTrackInfo> = Vec::new();

    let re_input = Regex::new(r"Input #0,\s*([^,]+(?:,[^,]+)*),\s*from\s").unwrap();
    let re_dur = Regex::new(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)").unwrap();
    let re_stream =
        Regex::new(r"^\s*Stream #0:\d+(?:\[[^\]]+\])?(?:\(([^)]+)\))?:\s*(Video|Audio|Subtitle):\s*([a-zA-Z0-9_+-]+)(.*)$")
            .unwrap();
    let re_title = Regex::new(r"(?i)^\s*title\s*:\s*(.+)$").unwrap();

    if let Some(cap) = re_input.captures(stderr) {
        container = cap[1].trim().to_ascii_lowercase();
    }
    if let Some(cap) = re_dur.captures(stderr) {
        let h: f64 = cap[1].parse().unwrap_or(0.0);
        let m: f64 = cap[2].parse().unwrap_or(0.0);
        let s: f64 = cap[3].parse().unwrap_or(0.0);
        duration_sec = h * 3600.0 + m * 60.0 + s;
    }

    enum LastTrack {
        None,
        Audio(usize),
        Subtitle(usize),
    }
    let mut last = LastTrack::None;

    for line in stderr.lines() {
        if let Some(cap) = re_stream.captures(line) {
            let lang = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("").to_string();
            let kind = &cap[2];
            let codec = cap[3].trim().to_ascii_lowercase();
            let rest = cap.get(4).map(|m| m.as_str()).unwrap_or("");
            let rest_lower = rest.to_ascii_lowercase();

            match kind {
                "Video" if video_codec.is_empty() && !rest_lower.contains("attached pic") => {
                    video_codec = codec;
                    ten_bit = rest_lower.contains("10le")
                        || rest_lower.contains("10be")
                        || rest_lower.contains("p010")
                        || rest_lower.contains("main 10");
                    if let Some(pf) = rest
                        .split(',')
                        .nth(1)
                        .map(|s| s.trim().split('(').next().unwrap_or("").trim())
                    {
                        video_pix_fmt = pf.to_string();
                    }
                    last = LastTrack::None;
                }
                "Audio" => {
                    let channels = if rest_lower.contains("7.1") {
                        "7.1"
                    } else if rest_lower.contains("5.1") {
                        "5.1"
                    } else if rest_lower.contains("stereo") || rest_lower.contains("2 channels") {
                        "2.0"
                    } else if rest_lower.contains("mono") {
                        "1.0"
                    } else {
                        ""
                    }
                    .to_string();

                    let idx = audio_tracks.len();
                    let lang_name = lang_display_es(&lang);
                    let codec_up = codec.to_ascii_uppercase();
                    let label = build_track_label(&lang_name, "", &codec_up, &channels, idx + 1, "Audio");
                    audio_tracks.push(AudioTrackInfo {
                        index: idx,
                        codec,
                        lang,
                        title: String::new(),
                        channels,
                        label,
                    });
                    last = LastTrack::Audio(idx);
                }
                "Subtitle" => {
                    let idx = subtitle_tracks.len();
                    let lang_name = lang_display_es(&lang);
                    let text_based = is_text_subtitle_codec(&codec);
                    let label = build_track_label(&lang_name, "", "", "", idx + 1, "Subtítulo");
                    subtitle_tracks.push(SubtitleTrackInfo {
                        index: idx,
                        codec,
                        lang,
                        title: String::new(),
                        label,
                        text_based,
                    });
                    last = LastTrack::Subtitle(idx);
                }
                _ => {
                    last = LastTrack::None;
                }
            }
            continue;
        }

        if let Some(cap) = re_title.captures(line) {
            let title = cap[1].trim().to_string();
            if !title.is_empty() {
                match last {
                    LastTrack::Audio(idx) => {
                        if let Some(t) = audio_tracks.get_mut(idx) {
                            t.title = title.clone();
                            let lang_name = lang_display_es(&t.lang);
                            let codec_up = t.codec.to_ascii_uppercase();
                            t.label = build_track_label(
                                &lang_name,
                                &title,
                                &codec_up,
                                &t.channels,
                                idx + 1,
                                "Audio",
                            );
                        }
                    }
                    LastTrack::Subtitle(idx) => {
                        if let Some(t) = subtitle_tracks.get_mut(idx) {
                            t.title = title.clone();
                            let lang_name = lang_display_es(&t.lang);
                            t.label = build_track_label(&lang_name, &title, "", "", idx + 1, "Subtítulo");
                        }
                    }
                    LastTrack::None => {}
                }
            }
        }
    }

    let first_audio_safe = audio_tracks
        .first()
        .map(|a| is_browser_safe_audio(&a.codec))
        .unwrap_or(true);
    let container_safe = is_browser_safe_container(&container);
    let video_safe = is_browser_safe_video(&video_codec, ten_bit);
    let can_copy_video = video_codec == "h264" && !ten_bit;

    // FFmpeg names both MKV and WebM "matroska,webm"; WebM-style codecs (VP8/VP9/AV1 with
    // Opus/Vorbis) play natively in WebView2, so they must not be sent to a costly transcode.
    let webm_native = container.to_ascii_lowercase().contains("webm")
        && matches!(video_codec.as_str(), "vp8" | "vp9" | "av1")
        && !ten_bit
        && audio_tracks.len() <= 1
        && audio_tracks
            .iter()
            .all(|a| matches!(a.codec.as_str(), "opus" | "vorbis"));

    let recommendation = if video_codec.is_empty() || webm_native {
        "native".to_string()
    } else if container_safe && video_safe && first_audio_safe && audio_tracks.len() <= 1 {
        "native".to_string()
    } else if can_copy_video {
        "videoCopy".to_string()
    } else {
        "transcode".to_string()
    };

    ProbeResult {
        duration_sec,
        container,
        video_codec,
        video_pix_fmt,
        ten_bit,
        audio_tracks,
        subtitle_tracks,
        recommendation,
    }
}

fn build_track_label(
    lang_name: &str,
    title: &str,
    codec: &str,
    channels: &str,
    num: usize,
    fallback_prefix: &str,
) -> String {
    let mut head = String::new();
    if !title.is_empty() && !lang_name.is_empty() {
        if title.to_ascii_lowercase().contains(&lang_name.to_ascii_lowercase()) {
            head.push_str(title);
        } else {
            head.push_str(lang_name);
            head.push_str(" · ");
            head.push_str(title);
        }
    } else if !title.is_empty() {
        head.push_str(title);
    } else if !lang_name.is_empty() {
        head.push_str(lang_name);
    } else {
        head.push_str(&format!("{fallback_prefix} {num}"));
    }
    let mut extras = Vec::new();
    if !codec.is_empty() {
        extras.push(codec);
    }
    if !channels.is_empty() {
        extras.push(channels);
    }
    if extras.is_empty() {
        head
    } else {
        format!("{head} ({})", extras.join(" "))
    }
}

impl MediaCompatEngine {
    pub fn new(proxy: ProxyStore) -> Self {
        Self {
            ffmpeg_path: locate_ffmpeg(),
            hw_encoder: Arc::new(OnceCell::new()),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_order: Arc::new(RwLock::new(VecDeque::new())),
            sub_cache: Arc::new(RwLock::new(HashMap::new())),
            sub_order: Arc::new(RwLock::new(VecDeque::new())),
            proxy,
            active_child: Arc::new(Mutex::new(None)),
            active_kill_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn available(&self) -> bool {
        self.ffmpeg_path.is_some()
    }

    /// Probes the GPU once per session (NVIDIA NVENC → Intel QSV → AMD AMF → libx264).
    pub async fn hw_encoder(&self) -> String {
        let Some(ref ffmpeg) = self.ffmpeg_path else {
            return "libx264".to_string();
        };
        let ff = ffmpeg.clone();
        self.hw_encoder
            .get_or_init(|| async move {
                #[cfg(target_os = "windows")]
                let candidates = ["h264_nvenc", "h264_qsv", "h264_amf"];
                #[cfg(not(target_os = "windows"))]
                let candidates: [&str; 0] = [];

                for enc in candidates {
                    let ok = tokio::time::timeout(Duration::from_secs(3), async {
                        let out = configure_cmd(&ff)
                            .args([
                                "-hide_banner",
                                "-loglevel",
                                "error",
                                "-f",
                                "lavfi",
                                "-i",
                                "color=c=black:s=256x256:d=0.05",
                                "-frames:v",
                                "1",
                                "-pix_fmt",
                                "yuv420p",
                                "-c:v",
                                enc,
                                "-f",
                                "null",
                                "-",
                            ])
                            .output()
                            .await;
                        out.map(|o| o.status.success()).unwrap_or(false)
                    })
                    .await
                    .unwrap_or(false);
                    if ok {
                        return enc.to_string();
                    }
                }
                "libx264".to_string()
            })
            .await
            .clone()
    }

    /// Turns a user/plugin supplied URL into the URL FFmpeg will open:
    /// - this service's own media routes are used as-is;
    /// - any other loopback target is refused;
    /// - remote http(s) URLs are NetGuard-checked and registered on the `/media/{token}`
    ///   proxy, so every hop, redirect, HLS child and key is re-checked by NetGuard and TLS
    ///   is always verified (rustls). The source headers travel with the proxy token.
    async fn prepare_input(
        &self,
        base_url: &str,
        raw_url: &str,
        headers: &HashMap<String, String>,
        allow_lan: bool,
    ) -> Result<Url, String> {
        let url = validate_media_url(raw_url)?;
        if let Some(own) = own_service_input(base_url, &url)? {
            return Ok(own);
        }
        let token = self
            .proxy
            .add_media_passive(url.to_string(), headers.clone(), allow_lan)
            .await?;
        Url::parse(&format!("{base_url}/media/{token}/{}", proxy_file_name(&url)))
            .map_err(|_| "Enlace multimedia no válido".to_string())
    }

    /// Inspects a stream URL using `ffmpeg -i` (no separate `ffprobe.exe` needed).
    pub async fn probe(
        &self,
        base_url: &str,
        raw_url: &str,
        headers: &HashMap<String, String>,
        allow_lan: bool,
    ) -> Result<Value, String> {
        let Some(ref ffmpeg) = self.ffmpeg_path else {
            return Ok(json!({
                "available": false,
                "recommendation": "native",
                "audioTracks": [],
                "subtitleTracks": []
            }));
        };
        let url = self.prepare_input(base_url, raw_url, headers, allow_lan).await?;

        let mut args = Vec::new();
        push_input_args(&mut args, &url, &HashMap::new());
        args.extend(["-i".into(), url.as_str().to_string()]);
        let out = tokio::time::timeout(
            Duration::from_secs(PROBE_TIMEOUT_SECS),
            configure_cmd(ffmpeg).args(&args).output(),
        )
        .await
        .map_err(|_| "Tiempo de espera agotado analizando el video".to_string())?
        .map_err(|e| format!("No se pudo ejecutar ffmpeg: {e}"))?;
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();

        let parsed = parse_ffmpeg_probe(&stderr);
        let hw = self.hw_encoder().await;
        let mut val = serde_json::to_value(parsed).unwrap_or_else(|_| json!({}));
        if let Some(obj) = val.as_object_mut() {
            obj.insert("available".into(), json!(true));
            obj.insert("hwEncoder".into(), json!(hw));
        }
        Ok(val)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start_session(
        &self,
        base_url: &str,
        raw_url: &str,
        headers: HashMap<String, String>,
        allow_lan: bool,
        hevc: bool,
        audio: usize,
        mode: &str,
    ) -> Result<Value, String> {
        if !self.available() {
            return Err("El motor de compatibilidad FFmpeg no está disponible".to_string());
        }
        let url = self.prepare_input(base_url, raw_url, &headers, allow_lan).await?;
        // The proxy token carries the source headers; FFmpeg talks only to loopback.
        let headers: HashMap<String, String> = HashMap::new();
        let token = rand_hex(12);
        {
            let mut map = self.sessions.write().await;
            let mut order = self.session_order.write().await;
            map.insert(
                token.clone(),
                CompatSession {
                    url: url.to_string(),
                    headers,
                    hevc,
                },
            );
            order.push_back(token.clone());
            while order.len() > MAX_COMPAT_SESSIONS {
                if let Some(old) = order.pop_front() {
                    map.remove(&old);
                }
            }
        }
        let clean_mode = if mode == "copy" || mode == "videoCopy" {
            "copy"
        } else {
            "transcode"
        };
        let hw = self.hw_encoder().await;
        Ok(json!({
            "token": token,
            "streamUrl": format!("{base_url}/compat/{token}.mp4?start=0&audio={audio}&mode={clean_mode}"),
            "subtitleBaseUrl": format!("{base_url}/compat-sub/{token}"),
            "hwEncoder": hw,
            "mode": clean_mode
        }))
    }

    /// Stops any currently running FFmpeg relay process immediately.
    pub async fn stop(&self) {
        if let Some(tx) = self.active_kill_tx.lock().await.take() {
            let _ = tx.send(());
        }
        *self.active_child.lock().await = None;
    }

    pub async fn serve_compat(
        &self,
        token: &str,
        start_sec: f64,
        audio: usize,
        mode: &str,
    ) -> Response {
        let Some(ref ffmpeg) = self.ffmpeg_path else {
            return Response::builder()
                .status(StatusCode::SERVICE_UNAVAILABLE)
                .body(Body::from("FFmpeg no disponible"))
                .unwrap();
        };
        let session = { self.sessions.read().await.get(token).cloned() };
        let Some(sess) = session else {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("Sesión no encontrada"))
                .unwrap();
        };
        let Ok(url) = validate_media_url(&sess.url) else {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("URL no válida"))
                .unwrap();
        };

        // Only one active FFmpeg relay stream at a time so seeks never pile up processes.
        self.stop().await;

        let video_copy = mode == "copy" || mode == "videoCopy";
        let hw = if video_copy {
            "copy".to_string()
        } else {
            self.hw_encoder().await
        };

        let mut args: Vec<String> = Vec::new();
        push_input_args(&mut args, &url, &sess.headers);
        args.extend(["-fflags".into(), "+genpts".into()]);
        if start_sec > 0.1 {
            if video_copy {
                args.push("-noaccurate_seek".into());
            }
            args.extend(["-ss".into(), format!("{start_sec:.3}")]);
        }
        args.extend([
            "-i".into(),
            url.as_str().to_string(),
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            format!("0:a:{audio}?"),
        ]);

        if video_copy {
            args.extend(["-c:v".into(), "copy".into()]);
            if sess.hevc {
                args.extend(["-tag:v".into(), "hvc1".into()]);
            }
        } else {
            match hw.as_str() {
                "h264_nvenc" => {
                    args.extend([
                        "-c:v".into(),
                        "h264_nvenc".into(),
                        "-preset".into(),
                        "p4".into(),
                        "-rc".into(),
                        "vbr".into(),
                        "-cq".into(),
                        "21".into(),
                        "-pix_fmt".into(),
                        "yuv420p".into(),
                    ]);
                }
                "h264_qsv" => {
                    args.extend([
                        "-c:v".into(),
                        "h264_qsv".into(),
                        "-preset".into(),
                        "veryfast".into(),
                        "-global_quality".into(),
                        "22".into(),
                        "-pix_fmt".into(),
                        "yuv420p".into(),
                    ]);
                }
                "h264_amf" => {
                    args.extend([
                        "-c:v".into(),
                        "h264_amf".into(),
                        "-quality".into(),
                        "speed".into(),
                        "-pix_fmt".into(),
                        "yuv420p".into(),
                    ]);
                }
                _ => {
                    args.extend([
                        "-c:v".into(),
                        "libx264".into(),
                        "-preset".into(),
                        "veryfast".into(),
                        "-crf".into(),
                        "21".into(),
                        "-pix_fmt".into(),
                        "yuv420p".into(),
                    ]);
                }
            }
        }

        args.extend([
            "-af".into(),
            "aresample=async=1000".into(),
            "-c:a".into(),
            "aac".into(),
            "-ac".into(),
            "2".into(),
            "-b:a".into(),
            "192k".into(),
            "-avoid_negative_ts".into(),
            "make_zero".into(),
            "-movflags".into(),
            "frag_keyframe+empty_moov+default_base_moof".into(),
            "-f".into(),
            "mp4".into(),
            "pipe:1".into(),
        ]);

        let mut child = match configure_cmd(ffmpeg)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => {
                return Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(Body::from("No se pudo iniciar FFmpeg"))
                    .unwrap();
            }
        };

        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill().await;
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("Sin salida de FFmpeg"))
                .unwrap();
        };

        let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
        *self.active_child.lock().await = child.id();
        *self.active_kill_tx.lock().await = Some(kill_tx);

        struct ChildGuard {
            child: Option<Child>,
            kill_rx: Option<tokio::sync::oneshot::Receiver<()>>,
        }
        impl Drop for ChildGuard {
            fn drop(&mut self) {
                if let Some(mut c) = self.child.take() {
                    let _ = c.start_kill();
                }
            }
        }

        let guard = ChildGuard {
            child: Some(child),
            kill_rx: Some(kill_rx),
        };

        let body_stream = stream::unfold(
            (stdout, guard, vec![0u8; 64 * 1024]),
            |(mut out, mut guard, mut buf)| async move {
                let mut rx = guard.kill_rx.take();
                let read_res = if let Some(ref mut r) = rx {
                    tokio::select! {
                        _ = r => None,
                        res = out.read(&mut buf) => Some(res),
                    }
                } else {
                    Some(out.read(&mut buf).await)
                };
                guard.kill_rx = rx;

                match read_res {
                    Some(Ok(n)) if n > 0 => {
                        let chunk = Bytes::copy_from_slice(&buf[..n]);
                        Some((Ok::<Bytes, std::io::Error>(chunk), (out, guard, buf)))
                    }
                    _ => {
                        if let Some(mut c) = guard.child.take() {
                            let _ = c.start_kill();
                        }
                        None
                    }
                }
            },
        );

        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "video/mp4")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from_stream(body_stream))
            .unwrap()
    }

    /// Extracts an embedded text subtitle track (`0:s:{sub_idx}`) directly to WebVTT.
    pub async fn serve_subtitle(&self, token: &str, sub_idx: usize) -> Response {
        let cors = |b: axum::http::response::Builder| {
            b.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Type, Content-Length")
        };
        let Some(ref ffmpeg) = self.ffmpeg_path else {
            return cors(Response::builder())
                .status(StatusCode::SERVICE_UNAVAILABLE)
                .body(Body::from("FFmpeg no disponible"))
                .unwrap();
        };
        let cache_key = format!("{token}:{sub_idx}");
        if let Some(cached) = self.sub_cache.read().await.get(&cache_key).cloned() {
            return cors(Response::builder())
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/vtt; charset=utf-8")
                .header(header::CACHE_CONTROL, "private, max-age=300")
                .body(Body::from(cached))
                .unwrap();
        }

        let session = { self.sessions.read().await.get(token).cloned() };
        let Some(sess) = session else {
            return cors(Response::builder())
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("Sesión no encontrada"))
                .unwrap();
        };
        let Ok(url) = validate_media_url(&sess.url) else {
            return cors(Response::builder())
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("URL no válida"))
                .unwrap();
        };
        let mut args: Vec<String> = Vec::new();
        push_input_args(&mut args, &url, &sess.headers);
        args.extend([
            "-i".into(),
            url.as_str().to_string(),
            "-map".into(),
            format!("0:s:{sub_idx}"),
            "-c:s".into(),
            "webvtt".into(),
            "-f".into(),
            "webvtt".into(),
            "pipe:1".into(),
        ]);

        let extracted = tokio::time::timeout(
            Duration::from_secs(SUB_EXTRACT_TIMEOUT_SECS),
            configure_cmd(ffmpeg)
                .args(&args)
                .stdin(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output(),
        )
        .await;

        match extracted {
            Ok(Ok(out)) if out.status.success() && !out.stdout.is_empty() && out.stdout.len() <= MAX_SUB_BYTES => {
                let data = out.stdout;
                {
                    let mut map = self.sub_cache.write().await;
                    let mut ord = self.sub_order.write().await;
                    map.insert(cache_key.clone(), data.clone());
                    ord.push_back(cache_key);
                    while ord.len() > MAX_SUB_CACHE {
                        if let Some(old) = ord.pop_front() {
                            map.remove(&old);
                        }
                    }
                }
                cors(Response::builder())
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/vtt; charset=utf-8")
                    .header(header::CACHE_CONTROL, "private, max-age=300")
                    .body(Body::from(data))
                    .unwrap()
            }
            _ => cors(Response::builder())
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("No se pudo extraer el subtítulo incrustado"))
                .unwrap(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dual_audio_mkv_with_ac3_dts_and_embedded_subs() {
        let sample = r#"
Input #0, matroska,webm, from 'http://127.0.0.1:8910/t/abc/movie.mkv':
  Duration: 02:14:35.50, start: 0.000000, bitrate: 12400 kb/s
  Stream #0:0(eng): Video: h264 (High), yuv420p(tv, bt709), 1920x1080, 23.98 fps
  Stream #0:1(spa): Audio: eac3, 48000 Hz, 5.1(side), fltp, 640 kb/s (default)
    Metadata:
      title           : Español Latino
  Stream #0:2(eng): Audio: dts (DTS-HD MA), 48000 Hz, 5.1(side), s32p
    Metadata:
      title           : Original English
  Stream #0:3(spa): Subtitle: subrip (default)
    Metadata:
      title           : Latino Completos
  Stream #0:4(eng): Subtitle: hdmv_pgs_subtitle
"#;
        let res = parse_ffmpeg_probe(sample);
        assert!((res.duration_sec - 8075.5).abs() < 0.01);
        assert_eq!(res.video_codec, "h264");
        assert!(!res.ten_bit);
        assert_eq!(res.recommendation, "videoCopy");
        assert_eq!(res.audio_tracks.len(), 2);
        assert_eq!(res.audio_tracks[0].codec, "eac3");
        assert!(res.audio_tracks[0].label.contains("Español Latino"));
        assert!(res.audio_tracks[0].label.contains("5.1"));
        assert_eq!(res.audio_tracks[1].codec, "dts");
        assert_eq!(res.subtitle_tracks.len(), 2);
        assert!(res.subtitle_tracks[0].text_based);
        assert!(!res.subtitle_tracks[1].text_based);
    }

    #[test]
    fn recommends_transcode_for_10bit_hevc_and_native_for_mp4_h264_aac() {
        let hevc10 = r#"
Input #0, matroska,webm, from 'http://127.0.0.1:8910/t/xyz/4k.mkv':
  Duration: 01:45:00.00, start: 0.000000
  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc), 3840x2160
  Stream #0:1(spa): Audio: truehd, 48000 Hz, 7.1
"#;
        let r1 = parse_ffmpeg_probe(hevc10);
        assert!(r1.ten_bit);
        assert_eq!(r1.recommendation, "transcode");

        let mp4 = r#"
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://cdn.example.com/movie.mp4':
  Duration: 01:30:00.00, start: 0.000000
  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080
  Stream #0:1(spa): Audio: aac (LC), 48000 Hz, stereo
"#;
        let r2 = parse_ffmpeg_probe(mp4);
        assert_eq!(r2.recommendation, "native");
    }

    #[test]
    fn every_ffmpeg_input_gets_the_protocol_whitelist_and_no_tls_override() {
        let url = Url::parse("http://127.0.0.1:8910/media/abc/stream.mkv").unwrap();
        let mut headers = HashMap::new();
        headers.insert("User-Agent".to_string(), "UA/1".to_string());
        headers.insert("Referer".to_string(), "https://site/".to_string());
        headers.insert("X-Bad".to_string(), "a\r\nHost: evil".to_string());
        let mut args = Vec::new();
        push_input_args(&mut args, &url, &headers);
        let pos = args.iter().position(|a| a == "-protocol_whitelist").expect("whitelist");
        let i = args.iter().position(|a| a == "-i").unwrap_or(args.len());
        assert!(pos < i);
        assert_eq!(args[pos + 1], "http,tcp,crypto");
        for banned in ["file", "https", "tls", "concat", "subfile", "data"] {
            assert!(!args[pos + 1].split(',').any(|p| p == banned), "{banned}");
        }
        assert!(!args.iter().any(|a| a == "-tls_verify"));
        assert!(args.windows(2).any(|w| w[0] == "-user_agent" && w[1] == "UA/1"));
        assert!(!args.iter().any(|a| a.contains("evil")));
    }

    #[test]
    fn only_own_media_routes_are_accepted_as_loopback_inputs() {
        let base = "http://127.0.0.1:8910";
        let ok = |u: &str| own_service_input(base, &Url::parse(u).unwrap());
        assert!(ok("http://127.0.0.1:8910/t/abc/movie.mkv").unwrap().is_some());
        assert!(ok("http://localhost:8910/media/tok/stream.m3u8").unwrap().is_some());
        assert!(ok("http://127.0.0.1:8910/local/tok/a.mp4").unwrap().is_some());
        // Remote URLs go through the proxy instead.
        assert!(ok("https://cdn.example.com/movie.mkv").unwrap().is_none());
        // Other loopback ports / RPC routes / other loopback IPs are refused.
        assert!(ok("http://127.0.0.1:9000/t/abc/movie.mkv").is_err());
        assert!(ok("http://127.0.0.1:8910/ping").is_err());
        assert!(ok("http://127.0.0.1:8910/appUpdate").is_err());
        assert!(ok("http://127.0.0.2:8910/t/abc/x.mkv").is_err());
        assert!(ok("http://[::1]:8910/t/abc/x.mkv").is_err());
        assert!(ok("https://127.0.0.1:8910/t/abc/x.mkv").is_err());
    }

    #[test]
    fn proxy_file_name_keeps_only_known_media_extensions() {
        let n = |u: &str| proxy_file_name(&Url::parse(u).unwrap());
        assert_eq!(n("https://a.b/x/master.m3u8?t=1"), "stream.m3u8");
        assert_eq!(n("https://a.b/x/Movie.MKV"), "stream.mkv");
        assert_eq!(n("https://a.b/x/play.php?id=1"), "stream");
        assert_eq!(n("https://a.b/"), "stream");
    }

    #[test]
    fn media_urls_must_be_http_or_https() {
        assert!(validate_media_url("file:///C:/Windows/win.ini").is_err());
        assert!(validate_media_url("concat:http://a|http://b").is_err());
        assert!(validate_media_url("https://cdn.example.com/a.mkv").is_ok());
    }

    #[test]
    fn webm_vp9_opus_plays_natively_but_mkv_hevc_does_not() {
        let webm = r#"
Input #0, matroska,webm, from 'https://cdn.example.com/clip.webm':
  Duration: 00:10:00.00, start: 0.000000
  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv), 1920x1080
  Stream #0:1(eng): Audio: opus, 48000 Hz, stereo, fltp
"#;
        let r = parse_ffmpeg_probe(webm);
        assert_eq!(r.video_codec, "vp9");
        assert_eq!(r.recommendation, "native");

        let mkv_hevc = r#"
Input #0, matroska,webm, from 'http://127.0.0.1:8910/t/abc/movie.mkv':
  Duration: 00:42:00.00, start: 0.000000
  Stream #0:0: Video: hevc (Main), yuv420p(tv), 1920x1080
  Stream #0:1(spa): Audio: ac3, 48000 Hz, 5.1(side), fltp, 384 kb/s
"#;
        assert_eq!(parse_ffmpeg_probe(mkv_hevc).recommendation, "transcode");
    }
}
