//! SubDL subtitles (https://subdl.com). Only active when an API key is available:
//! `OPENTV_SUBDL_KEY`, `config/subdl.json` (`{ "apiKey": "…" }`) in the working directory,
//! or the copy `build.rs` embeds (obfuscated) from the git-ignored `config/subdl.json`.
//! Without a key `subdlSearch` answers `available: false` and never errors.
//!
//! Search results point at this service (`/subdl/<token>`): the zip is downloaded lazily
//! through NetGuard, the subtitle inside is extracted with strict size limits, decoded
//! (UTF-8 / UTF-16 / Windows-1252) and served as SRT text, like `/sub/<token>`.
//!
//! The key is never logged nor returned: request errors are reduced to generic messages
//! because reqwest errors include the request URL (which carries `api_key`).

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;
use flate2::read::DeflateDecoder;
use rand::RngCore;
use serde_json::{json, Value};
use tokio::sync::RwLock;

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, FetchOptions};

const API: &str = "https://api.subdl.com/api/v1/subtitles";
const DL_BASE: &str = "https://dl.subdl.com";
/// Largest zip accepted from SubDL (subtitle zips are a few KB; season packs < 1 MB).
pub const MAX_ZIP_BYTES: usize = 8 * 1024 * 1024;
/// Largest uncompressed subtitle accepted (zip bomb protection).
pub const MAX_SUB_BYTES: usize = 5 * 1024 * 1024;
/// Central directory entries inspected at most.
pub const MAX_ZIP_ENTRIES: usize = 500;
const MAX_ES: usize = 8;
const MAX_EN: usize = 5;
const MAX_TOKENS: usize = 400;
const MAX_TEXTS: usize = 6;
const SEARCH_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const SEARCH_CACHE_MAX: usize = 200;

/// One search result as returned to the clients (`url` is built per request).
#[derive(Clone, Debug, PartialEq)]
pub struct SubdlHit {
    pub id: String,
    pub lang: String,
    pub label: String,
    /// Absolute `https://dl.subdl.com/subtitle/….zip` link.
    pub zip_url: String,
    pub latino: bool,
}

#[derive(Clone)]
struct Entry {
    zip_url: String,
    season: u32,
    episode: u32,
}

struct CachedSearch {
    at: Instant,
    hits: Vec<(SubdlHit, String)>,
}

#[derive(Clone)]
pub struct SubDl {
    dns: Dnsx,
    key: Option<Arc<str>>,
    entries: Arc<RwLock<HashMap<String, Entry>>>,
    order: Arc<RwLock<VecDeque<String>>>,
    texts: Arc<RwLock<VecDeque<(String, Arc<String>)>>>,
    searches: Arc<RwLock<HashMap<String, CachedSearch>>>,
}

impl SubDl {
    pub fn new(dns: Dnsx) -> Self {
        Self::with_key(dns, load_key())
    }

    pub fn with_key(dns: Dnsx, key: Option<String>) -> Self {
        Self {
            dns,
            key: key.map(Arc::from),
            entries: Arc::new(RwLock::new(HashMap::new())),
            order: Arc::new(RwLock::new(VecDeque::new())),
            texts: Arc::new(RwLock::new(VecDeque::new())),
            searches: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn available(&self) -> bool {
        self.key.is_some()
    }

    /// `subdlSearch` RPC: `{imdbId, kind: "movie"|"series", season?, episode?}`.
    pub async fn search(&self, params: &Value, base_url: &str) -> Value {
        let Some(key) = self.key.clone() else {
            return json!({ "available": false, "subtitles": [] });
        };
        let imdb = params["imdbId"].as_str().unwrap_or("").split(':').next().unwrap_or("");
        if !is_imdb_id(imdb) {
            return json!({ "available": true, "subtitles": [], "error": "Id no válido" });
        }
        let series = matches!(params["kind"].as_str(), Some("series") | Some("tv"));
        let season = num_param(&params["season"]);
        let episode = num_param(&params["episode"]);
        let (season, episode) = if series { (season, episode) } else { (0, 0) };

        let cache_key = format!("{imdb}:{series}:{season}:{episode}");
        let cached = {
            let guard = self.searches.read().await;
            guard
                .get(&cache_key)
                .filter(|c| c.at.elapsed() < SEARCH_TTL)
                .map(|c| c.hits.clone())
        };
        let hits = match cached {
            Some(hits) => {
                // Tokens may have been evicted since: register them again.
                for (hit, token) in &hits {
                    self.register(token, hit, season, episode).await;
                }
                hits
            }
            None => {
                let url = search_url(&key, imdb, series, season, episode);
                let Ok(json) = self.get_json(&url).await else {
                    return json!({ "available": true, "subtitles": [], "error": "SubDL no respondió" });
                };
                let mut hits = Vec::new();
                for hit in rank_hits(parse_search(&json)) {
                    let token = rand_token();
                    self.register(&token, &hit, season, episode).await;
                    hits.push((hit, token));
                }
                let mut guard = self.searches.write().await;
                if guard.len() >= SEARCH_CACHE_MAX {
                    guard.clear();
                }
                guard.insert(cache_key, CachedSearch { at: Instant::now(), hits: hits.clone() });
                hits
            }
        };
        let subtitles: Vec<Value> = hits
            .iter()
            .map(|(h, token)| {
                json!({
                    "id": h.id,
                    "lang": h.lang,
                    "label": h.label,
                    "format": "srt",
                    "url": format!("{base_url}/subdl/{token}.srt")
                })
            })
            .collect();
        json!({ "available": true, "subtitles": subtitles })
    }

    async fn register(&self, token: &str, hit: &SubdlHit, season: u32, episode: u32) {
        let mut map = self.entries.write().await;
        if map.contains_key(token) {
            return;
        }
        let mut ord = self.order.write().await;
        map.insert(
            token.to_string(),
            Entry { zip_url: hit.zip_url.clone(), season, episode },
        );
        ord.push_back(token.to_string());
        while ord.len() > MAX_TOKENS {
            if let Some(old) = ord.pop_front() {
                map.remove(&old);
            }
        }
    }

    /// `GET /subdl/<token>[.srt]`: the extracted subtitle as UTF-8 SRT text.
    pub async fn serve(&self, raw_token: &str) -> Response {
        let token = raw_token.trim_end_matches(".srt");
        if let Some((_, text)) = self.texts.read().await.iter().find(|(t, _)| t == token) {
            return text_response(StatusCode::OK, text.as_str().to_string());
        }
        let Some(entry) = self.entries.read().await.get(token).cloned() else {
            return text_response(StatusCode::NOT_FOUND, "Subtítulo no encontrado".into());
        };
        let bytes = match self.download(&entry.zip_url).await {
            Ok(b) => b,
            Err(e) => return text_response(StatusCode::BAD_GATEWAY, e),
        };
        let raw = if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
            match extract_subtitle(&bytes, entry.season, entry.episode) {
                Ok((_, data)) => data,
                Err(e) => return text_response(StatusCode::BAD_GATEWAY, e.to_string()),
            }
        } else if bytes.len() <= MAX_SUB_BYTES {
            bytes
        } else {
            return text_response(StatusCode::BAD_GATEWAY, "Subtítulo demasiado grande".into());
        };
        let text = to_srt(&decode_text(&raw));
        if !text.contains("-->") {
            return text_response(StatusCode::BAD_GATEWAY, "Subtítulo no válido".into());
        }
        let shared = Arc::new(text);
        {
            let mut texts = self.texts.write().await;
            texts.push_back((token.to_string(), shared.clone()));
            while texts.len() > MAX_TEXTS {
                texts.pop_front();
            }
        }
        text_response(StatusCode::OK, shared.as_str().to_string())
    }

    async fn get_json(&self, url: &str) -> Result<Value, ()> {
        let mut opts = FetchOptions::new(&self.dns, false, Duration::from_secs(10));
        opts.user_agent = Some("OpenTV".to_string());
        let resp = fetch_url(url, opts).await.map_err(|_| ())?;
        if !resp.status().is_success() {
            return Err(());
        }
        let body = read_capped(resp, 2 * 1024 * 1024).await.map_err(|_| ())?;
        serde_json::from_slice(&body).map_err(|_| ())
    }

    async fn download(&self, url: &str) -> Result<Vec<u8>, String> {
        let mut opts = FetchOptions::new(&self.dns, false, Duration::from_secs(15));
        opts.user_agent = Some("OpenTV".to_string());
        let resp = fetch_url(url, opts)
            .await
            .map_err(|_| "Sin conexión con SubDL".to_string())?;
        if !resp.status().is_success() {
            return Err(format!("SubDL respondió {}", resp.status().as_u16()));
        }
        read_capped(resp, MAX_ZIP_BYTES).await
    }
}

async fn read_capped(mut resp: reqwest::Response, cap: usize) -> Result<Vec<u8>, String> {
    if resp.content_length().is_some_and(|n| n as usize > cap) {
        return Err("Archivo demasiado grande".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|_| "Lectura interrumpida".to_string())?
    {
        if out.len() + chunk.len() > cap {
            return Err("Archivo demasiado grande".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

fn text_response(status: StatusCode, body: String) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .body(Body::from(body))
        .unwrap()
}

fn rand_token() -> String {
    let mut b = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn num_param(v: &Value) -> u32 {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
        .filter(|n| *n < 10_000)
        .unwrap_or(0) as u32
}

fn is_imdb_id(s: &str) -> bool {
    s.len() >= 7 && s.len() <= 12 && s.starts_with("tt") && s[2..].chars().all(|c| c.is_ascii_digit())
}

/// SubDL search URL (key URL-encoded; never logged).
pub fn search_url(key: &str, imdb: &str, series: bool, season: u32, episode: u32) -> String {
    let enc: String = url::form_urlencoded::byte_serialize(key.as_bytes()).collect();
    let mut url = format!(
        "{API}?api_key={enc}&imdb_id={imdb}&type={}&languages=ES,EN&subs_per_page=30",
        if series { "tv" } else { "movie" }
    );
    if series && season > 0 {
        url.push_str(&format!("&season_number={season}"));
        if episode > 0 {
            url.push_str(&format!("&episode_number={episode}"));
        }
    }
    url
}

/// Language code from SubDL's `language` ("ES") or `lang` ("spanish", "English") fields.
fn lang_code(sub: &Value) -> Option<String> {
    for field in ["language", "lang"] {
        let raw = sub[field].as_str().unwrap_or("").trim().to_ascii_lowercase();
        if raw.is_empty() {
            continue;
        }
        if raw.starts_with("es") || raw.contains("spanish") || raw.contains("español") || raw.contains("espanol") {
            return Some("es".into());
        }
        if raw.starts_with("en") || raw.contains("english") {
            return Some("en".into());
        }
        if raw.len() == 2 && raw.chars().all(|c| c.is_ascii_alphabetic()) {
            return Some(raw);
        }
    }
    None
}

/// Latin-American Spanish hints in a release name / label.
pub fn is_latino(text: &str) -> bool {
    let low = text.to_lowercase();
    if low.contains("es-419") || low.contains("es_419") || low.contains("latin america") || low.contains("latinoam") {
        return true;
    }
    low.split(|c: char| !c.is_alphanumeric()).any(|t| {
        matches!(t, "latino" | "latina" | "lat" | "latam" | "latin" | "mx" | "mex" | "mexico" | "méxico" | "419")
    })
}

/// Accepts only SubDL download paths (`/subtitle/<id>.zip`) or absolute dl.subdl.com links.
fn zip_url(raw: &str) -> Option<String> {
    let path = raw.trim();
    let path = path.strip_prefix(DL_BASE).unwrap_or(path);
    if !path.starts_with('/') || path.contains("..") || path.len() > 200 {
        return None;
    }
    if !path.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.')) {
        return None;
    }
    Some(format!("{DL_BASE}{path}"))
}

/// Parses SubDL's search answer. The documented shape is
/// `{status, subtitles: [{release_name, name, lang, language, url, season, episode, hi, …}]}`;
/// every field is read defensively.
pub fn parse_search(json: &Value) -> Vec<SubdlHit> {
    if json["status"].as_bool() == Some(false) {
        return Vec::new();
    }
    let mut out: Vec<SubdlHit> = Vec::new();
    for sub in json["subtitles"].as_array().into_iter().flatten() {
        let Some(zip) = sub["url"].as_str().and_then(zip_url) else {
            continue;
        };
        if out.iter().any(|h| h.zip_url == zip) {
            continue;
        }
        let Some(lang) = lang_code(sub) else {
            continue;
        };
        let release = sub["release_name"]
            .as_str()
            .or_else(|| sub["name"].as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let hints = format!(
            "{release} {} {} {}",
            sub["name"].as_str().unwrap_or(""),
            sub["lang"].as_str().unwrap_or(""),
            sub["language"].as_str().unwrap_or("")
        );
        let latino = lang == "es" && is_latino(&hints);
        let lang_label = match (lang.as_str(), latino) {
            ("es", true) => "Español latino".to_string(),
            ("es", false) => "Español".to_string(),
            ("en", _) => "Inglés".to_string(),
            (other, _) => other.to_uppercase(),
        };
        let short: String = release.chars().take(70).collect();
        let mut label = if short.is_empty() { lang_label } else { format!("{lang_label} · {short}") };
        if sub["hi"].as_bool() == Some(true) {
            label.push_str(" (para sordos)");
        }
        let stem = zip
            .rsplit('/')
            .next()
            .unwrap_or("")
            .trim_end_matches(".zip")
            .to_string();
        out.push(SubdlHit { id: format!("subdl:{stem}"), lang, label, zip_url: zip, latino });
    }
    out
}

/// Latin-American Spanish first, then other Spanish, then English (each capped).
pub fn rank_hits(hits: Vec<SubdlHit>) -> Vec<SubdlHit> {
    let es_lat = hits.iter().filter(|h| h.lang == "es" && h.latino);
    let es = hits.iter().filter(|h| h.lang == "es" && !h.latino);
    let mut out: Vec<SubdlHit> = es_lat.chain(es).take(MAX_ES).cloned().collect();
    out.extend(hits.iter().filter(|h| h.lang == "en").take(MAX_EN).cloned());
    out
}

#[derive(Debug, PartialEq)]
pub enum ZipError {
    NotZip,
    NoSubtitle,
    TooLarge,
    Corrupt,
}

impl std::fmt::Display for ZipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ZipError::NotZip => "Archivo no válido",
            ZipError::NoSubtitle => "El archivo no trae subtítulos",
            ZipError::TooLarge => "Subtítulo demasiado grande",
            ZipError::Corrupt => "Archivo dañado",
        })
    }
}

// Offsets come from untrusted zip headers: every addition is checked so a crafted value
// cannot overflow `usize` (32-bit on armeabi-v7a Fire TV builds).
fn u16_at(b: &[u8], i: usize) -> Option<usize> {
    b.get(i..i.checked_add(2)?).map(|s| u16::from_le_bytes([s[0], s[1]]) as usize)
}

fn u32_at(b: &[u8], i: usize) -> Option<usize> {
    b.get(i..i.checked_add(4)?).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize)
}

fn add(parts: &[usize]) -> Result<usize, ZipError> {
    parts.iter().try_fold(0usize, |acc, n| acc.checked_add(*n)).ok_or(ZipError::Corrupt)
}

struct ZipEntry {
    name: String,
    method: usize,
    flags: usize,
    comp_size: usize,
    size: usize,
    local_offset: usize,
}

fn sub_ext_rank(name: &str) -> Option<u8> {
    let low = name.to_ascii_lowercase();
    if low.ends_with(".srt") {
        Some(0)
    } else if low.ends_with(".vtt") {
        Some(1)
    } else if low.ends_with(".ass") || low.ends_with(".ssa") {
        Some(2)
    } else {
        None
    }
}

/// True when a file name looks like episode `season`x`episode` (S01E02, 1x02, …).
pub fn name_matches_episode(name: &str, season: u32, episode: u32) -> bool {
    let low = name.to_ascii_lowercase();
    let pats = [
        format!("s{season:02}e{episode:02}"),
        format!("s{season}e{episode:02}"),
        format!("s{season:02}.e{episode:02}"),
        format!("{season}x{episode:02}"),
    ];
    pats.iter().any(|p| {
        low.match_indices(p.as_str()).any(|(i, _)| {
            // Not followed by another digit (E02 must not match E021).
            !low[i + p.len()..].chars().next().is_some_and(|c| c.is_ascii_digit())
                && !(p.starts_with(|c: char| c.is_ascii_digit())
                    && low[..i].chars().last().is_some_and(|c| c.is_ascii_digit()))
        })
    })
}

/// Extracts the subtitle from a SubDL zip: prefers the requested episode in season packs,
/// then `.srt` over `.vtt` over `.ass`. Only stored/deflate entries, no encryption, no ZIP64,
/// at most `MAX_ZIP_ENTRIES` entries and `MAX_SUB_BYTES` uncompressed.
pub fn extract_subtitle(zip: &[u8], season: u32, episode: u32) -> Result<(String, Vec<u8>), ZipError> {
    if zip.len() < 22 {
        return Err(ZipError::NotZip);
    }
    // End of central directory (comment up to 64 KB).
    let min = zip.len().saturating_sub(22 + 65_535);
    let eocd = (min..=zip.len() - 22)
        .rev()
        .find(|&i| zip[i..i + 4] == [0x50, 0x4b, 0x05, 0x06])
        .ok_or(ZipError::NotZip)?;
    let count = u16_at(zip, eocd + 10).ok_or(ZipError::Corrupt)?;
    let mut pos = u32_at(zip, eocd + 16).ok_or(ZipError::Corrupt)?;

    let mut entries: Vec<ZipEntry> = Vec::new();
    for _ in 0..count.min(MAX_ZIP_ENTRIES) {
        // A central directory record is 46 bytes plus its variable fields.
        if u32_at(zip, pos) != Some(0x0201_4b50) || zip.len() < add(&[pos, 46])? {
            return Err(ZipError::Corrupt);
        }
        let flags = u16_at(zip, pos + 8).ok_or(ZipError::Corrupt)?;
        let method = u16_at(zip, pos + 10).ok_or(ZipError::Corrupt)?;
        let comp_size = u32_at(zip, pos + 20).ok_or(ZipError::Corrupt)?;
        let size = u32_at(zip, pos + 24).ok_or(ZipError::Corrupt)?;
        let name_len = u16_at(zip, pos + 28).ok_or(ZipError::Corrupt)?;
        let extra_len = u16_at(zip, pos + 30).ok_or(ZipError::Corrupt)?;
        let comment_len = u16_at(zip, pos + 32).ok_or(ZipError::Corrupt)?;
        let local_offset = u32_at(zip, pos + 42).ok_or(ZipError::Corrupt)?;
        let name_bytes = zip.get(pos + 46..pos + 46 + name_len).ok_or(ZipError::Corrupt)?;
        entries.push(ZipEntry {
            name: String::from_utf8_lossy(name_bytes).into_owned(),
            method,
            flags,
            comp_size,
            size,
            local_offset,
        });
        pos = add(&[pos, 46, name_len, extra_len, comment_len])?;
    }

    let mut subs: Vec<&ZipEntry> = entries
        .iter()
        .filter(|e| !e.name.ends_with('/') && !e.name.contains("__MACOSX"))
        .filter(|e| sub_ext_rank(&e.name).is_some())
        .collect();
    if subs.is_empty() {
        return Err(ZipError::NoSubtitle);
    }
    let wants_episode = season > 0 && episode > 0;
    subs.sort_by_key(|e| {
        let ep_miss = wants_episode && !name_matches_episode(&e.name, season, episode);
        (ep_miss, sub_ext_rank(&e.name).unwrap_or(9))
    });

    let mut last_err = ZipError::NoSubtitle;
    for e in subs {
        match read_entry(zip, e) {
            Ok(data) => {
                let name = e.name.rsplit('/').next().unwrap_or(&e.name).to_string();
                return Ok((name, data));
            }
            Err(err) => last_err = err,
        }
    }
    Err(last_err)
}

fn read_entry(zip: &[u8], e: &ZipEntry) -> Result<Vec<u8>, ZipError> {
    if e.flags & 0x1 != 0 || e.comp_size == 0xFFFF_FFFF || e.size == 0xFFFF_FFFF {
        return Err(ZipError::Corrupt);
    }
    if e.size > MAX_SUB_BYTES {
        return Err(ZipError::TooLarge);
    }
    let lo = e.local_offset;
    // Local header is 30 bytes; checking that first keeps `lo + 26/28` in range.
    if u32_at(zip, lo) != Some(0x0403_4b50) || zip.len() < add(&[lo, 30])? {
        return Err(ZipError::Corrupt);
    }
    let name_len = u16_at(zip, lo + 26).ok_or(ZipError::Corrupt)?;
    let extra_len = u16_at(zip, lo + 28).ok_or(ZipError::Corrupt)?;
    let start = add(&[lo, 30, name_len, extra_len])?;
    let data = zip.get(start..add(&[start, e.comp_size])?).ok_or(ZipError::Corrupt)?;
    match e.method {
        0 => {
            if data.len() > MAX_SUB_BYTES {
                return Err(ZipError::TooLarge);
            }
            Ok(data.to_vec())
        }
        8 => {
            // The declared size can lie: cap the actual inflated output.
            let mut out = Vec::new();
            DeflateDecoder::new(data)
                .take(MAX_SUB_BYTES as u64 + 1)
                .read_to_end(&mut out)
                .map_err(|_| ZipError::Corrupt)?;
            if out.len() > MAX_SUB_BYTES {
                return Err(ZipError::TooLarge);
            }
            Ok(out)
        }
        _ => Err(ZipError::Corrupt),
    }
}

/// Subtitle bytes -> text: UTF-8 (BOM or valid), UTF-16 (BOM or NUL pattern), else Windows-1252
/// (superset of Latin-1, what Spanish subtitles without BOM usually use).
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE.decode_without_bom_handling(&bytes[2..]).0.into_owned();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE.decode_without_bom_handling(&bytes[2..]).0.into_owned();
    }
    let sample = &bytes[..bytes.len().min(400)];
    if sample.len() >= 8 {
        let odd_nul = sample.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
        let even_nul = sample.iter().step_by(2).filter(|b| **b == 0).count();
        let half = sample.len() / 2;
        if odd_nul * 10 >= half * 7 {
            return encoding_rs::UTF_16LE.decode_without_bom_handling(bytes).0.into_owned();
        }
        if even_nul * 10 >= half * 7 {
            return encoding_rs::UTF_16BE.decode_without_bom_handling(bytes).0.into_owned();
        }
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned(),
    }
}

/// Normalizes SRT / WebVTT / ASS text to SRT.
pub fn to_srt(text: &str) -> String {
    let clean = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let head = clean.trim_start();
    if head.starts_with("WEBVTT") {
        return vtt_to_srt(head);
    }
    if head.starts_with("[Script Info]") || (clean.contains("[Events]") && clean.contains("Dialogue:")) {
        return ass_to_srt(&clean);
    }
    clean
}

fn vtt_time_to_srt(t: &str) -> Option<String> {
    let t = t.trim();
    let (hms, ms) = t.split_once('.').unwrap_or((t, "000"));
    let parts: Vec<&str> = hms.split(':').collect();
    let (h, m, s) = match parts.as_slice() {
        [m, s] => ("0", *m, *s),
        [h, m, s] => (*h, *m, *s),
        _ => return None,
    };
    let n = |x: &str| x.parse::<u32>().ok();
    let ms: String = ms.chars().take(3).collect();
    Some(format!("{:02}:{:02}:{:02},{:0<3}", n(h)?, n(m)?, n(s)?, ms))
}

fn vtt_to_srt(text: &str) -> String {
    let mut out = String::new();
    let mut n = 0;
    for block in text.split("\n\n") {
        let lines: Vec<&str> = block.lines().collect();
        let Some(ti) = lines.iter().position(|l| l.contains("-->")) else {
            continue;
        };
        let (a, b) = lines[ti].split_once("-->").unwrap_or(("", ""));
        let end = b.split_whitespace().next().unwrap_or("");
        let (Some(start), Some(end)) = (vtt_time_to_srt(a), vtt_time_to_srt(end)) else {
            continue;
        };
        let body: Vec<&str> = lines[ti + 1..].iter().copied().filter(|l| !l.trim().is_empty()).collect();
        if body.is_empty() {
            continue;
        }
        n += 1;
        out.push_str(&format!("{n}\n{start} --> {end}\n{}\n\n", body.join("\n")));
    }
    out
}

fn ass_time_to_srt(t: &str) -> Option<(u64, String)> {
    let (hms, cs) = t.trim().split_once('.')?;
    let mut it = hms.split(':');
    let h: u64 = it.next()?.parse().ok()?;
    let m: u64 = it.next()?.parse().ok()?;
    let s: u64 = it.next()?.parse().ok()?;
    let frac: String = cs.chars().take(3).collect();
    let ms: u64 = format!("{frac:0<3}").parse().ok()?;
    // Absurd hour values must not overflow (debug builds panic on overflow).
    if h > 99 || m > 59 || s > 59 {
        return None;
    }
    let total = ((h * 60 + m) * 60 + s) * 1000 + ms;
    Some((total, format!("{h:02}:{m:02}:{s:02},{ms:03}")))
}

fn ass_to_srt(text: &str) -> String {
    let mut fields: Vec<String> = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut in_events = false;
    let mut cues: Vec<(u64, String, String, String)> = Vec::new();
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            in_events = l.eq_ignore_ascii_case("[events]");
            continue;
        }
        if !in_events {
            continue;
        }
        if let Some(f) = l.strip_prefix("Format:") {
            fields = f.split(',').map(|s| s.trim().to_ascii_lowercase()).collect();
            continue;
        }
        let Some(d) = l.strip_prefix("Dialogue:") else {
            continue;
        };
        let parts: Vec<&str> = d.trim_start().splitn(fields.len(), ',').collect();
        let get = |name: &str| fields.iter().position(|f| f == name).and_then(|i| parts.get(i).copied());
        let (Some(st), Some(en), Some(raw)) = (get("start"), get("end"), get("text")) else {
            continue;
        };
        let (Some((key, start)), Some((_, end))) = (ass_time_to_srt(st), ass_time_to_srt(en)) else {
            continue;
        };
        let mut body = String::new();
        let mut depth = 0;
        for c in raw.chars() {
            match c {
                '{' => depth += 1,
                '}' if depth > 0 => depth -= 1,
                _ if depth == 0 => body.push(c),
                _ => {}
            }
        }
        let body = body.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ");
        let body = body.trim();
        if body.is_empty() {
            continue;
        }
        cues.push((key, start, end, body.to_string()));
    }
    cues.sort_by_key(|c| c.0);
    let mut out = String::new();
    for (i, (_, s, e, b)) in cues.iter().enumerate() {
        out.push_str(&format!("{}\n{s} --> {e}\n{b}\n\n", i + 1));
    }
    out
}

/// Obfuscated `config/subdl.json` written by `build.rs` (empty when the file was missing).
static EMBEDDED: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/subdl.bin"));

fn embedded_json() -> Option<String> {
    if EMBEDDED.len() < 10 || EMBEDDED[0] != 1 {
        return None;
    }
    let mut seed_bytes = [0u8; 8];
    seed_bytes.copy_from_slice(&EMBEDDED[1..9]);
    let mut st = (u64::from_le_bytes(seed_bytes) ^ 0x7375_6264_6c6b_6579).max(1);
    let plain: Vec<u8> = EMBEDDED[9..]
        .iter()
        .map(|b| {
            // Same xorshift stream as build.rs.
            st ^= st << 13;
            st ^= st >> 7;
            st ^= st << 17;
            b ^ ((st >> 24) as u8)
        })
        .collect();
    String::from_utf8(plain).ok()
}

/// `{ "apiKey": "…" }` -> key (only plain token characters accepted).
pub fn key_from_json(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    valid_key(v["apiKey"].as_str().unwrap_or(""))
}

fn valid_key(k: &str) -> Option<String> {
    let k = k.trim();
    (!k.is_empty() && k.len() <= 128 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .then(|| k.to_string())
}

fn load_key() -> Option<String> {
    if let Some(k) = std::env::var("OPENTV_SUBDL_KEY").ok().as_deref().and_then(valid_key) {
        return Some(k);
    }
    if let Some(k) = std::fs::read_to_string("config/subdl.json").ok().as_deref().and_then(key_from_json) {
        return Some(k);
    }
    embedded_json().as_deref().and_then(key_from_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn sample() -> Value {
        json!({ "status": true, "results": [{ "sd_id": 1, "imdb_id": "tt0111161" }], "subtitles": [
            { "release_name": "The.Movie.2024.1080p.WEB-DL", "name": "SUBDL::x.zip", "lang": "english", "language": "EN",
              "url": "/subtitle/3197651-3213944.zip", "season": 0, "episode": 0, "hi": false },
            { "release_name": "The.Movie.2024.1080p.WEB-DL", "lang": "spanish", "language": "ES",
              "url": "/subtitle/1-2.zip", "hi": true },
            { "release_name": "The Movie 2024 Español Latino", "lang": "spanish", "language": "ES",
              "url": "/subtitle/3-4.zip" },
            { "release_name": "Dup", "lang": "spanish", "language": "ES", "url": "/subtitle/3-4.zip" },
            { "release_name": "Evil", "lang": "spanish", "language": "ES", "url": "https://evil.example/x.zip" },
            { "release_name": "Traversal", "lang": "spanish", "language": "ES", "url": "/subtitle/../../x.zip" },
            { "release_name": "No lang", "url": "/subtitle/9-9.zip" },
            { "release_name": "Absolute", "lang": "English", "url": "https://dl.subdl.com/subtitle/5-6.zip" }
        ]})
    }

    #[test]
    fn parses_and_ranks_latino_first() {
        let hits = parse_search(&sample());
        assert_eq!(hits.len(), 4);
        assert_eq!(hits[0].zip_url, "https://dl.subdl.com/subtitle/3197651-3213944.zip");
        assert_eq!(hits[0].id, "subdl:3197651-3213944");
        assert_eq!(hits[3].zip_url, "https://dl.subdl.com/subtitle/5-6.zip");
        let ranked = rank_hits(hits);
        let langs: Vec<(&str, bool)> = ranked.iter().map(|h| (h.lang.as_str(), h.latino)).collect();
        assert_eq!(langs, vec![("es", true), ("es", false), ("en", false), ("en", false)]);
        assert!(ranked[0].label.starts_with("Español latino · "));
        assert!(ranked[1].label.ends_with("(para sordos)"));
        assert!(ranked[2].label.starts_with("Inglés · "));
        assert!(parse_search(&json!({ "status": false, "error": "bad key" })).is_empty());
        assert!(parse_search(&json!({})).is_empty());
    }

    #[test]
    fn latino_hints() {
        assert!(is_latino("Movie.2024.WEB.Spanish.LAT"));
        assert!(is_latino("Serie es-419"));
        assert!(is_latino("Subtitulos Mexico"));
        assert!(!is_latino("Movie.2024.Castellano"));
        assert!(!is_latino("Platinum.Edition"));
    }

    #[test]
    fn search_url_shape() {
        let u = search_url("k&y", "tt0944947", true, 1, 2);
        assert!(u.starts_with("https://api.subdl.com/api/v1/subtitles?api_key=k%26y&imdb_id=tt0944947&type=tv"));
        assert!(u.ends_with("&season_number=1&episode_number=2"));
        let m = search_url("k", "tt1", false, 1, 2);
        assert!(m.contains("type=movie") && !m.contains("season_number"));
        assert!(m.contains("languages=ES,EN&subs_per_page=30"));
    }

    #[tokio::test]
    async fn no_key_means_unavailable_not_error() {
        let sd = SubDl::with_key(Dnsx::new(), None);
        assert!(!sd.available());
        let out = sd.search(&json!({ "imdbId": "tt0111161", "kind": "movie" }), "http://127.0.0.1:1").await;
        assert_eq!(out, json!({ "available": false, "subtitles": [] }));
        assert_eq!(key_from_json(r#"{"apiKey":"  abc_DEF-123 "}"#), Some("abc_DEF-123".into()));
        assert_eq!(key_from_json(r#"{"apiKey":""}"#), None);
        assert_eq!(key_from_json(r#"{"apiKey":"a b&c"}"#), None);
        assert_eq!(key_from_json("nope"), None);
    }

    /// Minimal zip writer for the tests (stored or deflate).
    fn make_zip(files: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, data, deflate) in files {
            let payload = if *deflate {
                let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
                enc.write_all(data).unwrap();
                enc.finish().unwrap()
            } else {
                data.to_vec()
            };
            let method: u16 = if *deflate { 8 } else { 0 };
            let offset = out.len() as u32;
            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            out.extend_from_slice(&[20, 0, 0, 0]);
            out.extend_from_slice(&method.to_le_bytes());
            out.extend_from_slice(&[0; 8]); // time, date, crc
            out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(&payload);

            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&[20, 0, 20, 0, 0, 0]);
            central.extend_from_slice(&method.to_le_bytes());
            central.extend_from_slice(&[0; 8]);
            central.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0; 12]); // extra, comment, disk, int attr, ext attr (4)
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let cd_offset = out.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&[0, 0]);
        out
    }

    const SRT: &[u8] = b"1\n00:00:01,000 --> 00:00:02,000\nHola\n";

    #[test]
    fn extracts_srt_and_picks_episode_from_season_pack() {
        let zip = make_zip(&[("readme.txt", b"x", false), ("Movie.ass", b"[Script Info]", true), ("Movie.srt", SRT, true)]);
        let (name, data) = extract_subtitle(&zip, 0, 0).unwrap();
        assert_eq!(name, "Movie.srt");
        assert_eq!(data, SRT);

        let pack = make_zip(&[
            ("Show.S01E01.srt", b"one", false),
            ("Show.S01E02.srt", b"two", true),
            ("Show.S01E021.srt", b"bad", false),
        ]);
        assert_eq!(extract_subtitle(&pack, 1, 2).unwrap().1, b"two");
        assert_eq!(extract_subtitle(&pack, 1, 1).unwrap().1, b"one");
        assert!(name_matches_episode("show 1x02 [720p].srt", 1, 2));
        assert!(!name_matches_episode("show 11x02.srt", 1, 2));
        assert_eq!(extract_subtitle(&make_zip(&[("a.txt", b"x", false)]), 0, 0), Err(ZipError::NoSubtitle));
        assert_eq!(extract_subtitle(b"not a zip at all, definitely", 0, 0), Err(ZipError::NotZip));
    }

    #[test]
    fn zip_bomb_is_refused() {
        let big = vec![b'a'; MAX_SUB_BYTES + 10];
        let zip = make_zip(&[("bomb.srt", &big, true)]);
        assert!(zip.len() < 64 * 1024);
        assert_eq!(extract_subtitle(&zip, 0, 0), Err(ZipError::TooLarge));
        // Lying about the size in the headers does not help: the inflated output is capped.
        let mut lying = zip.clone();
        let cd = lying.len() - 22 - (46 + "bomb.srt".len());
        lying[cd + 24..cd + 28].copy_from_slice(&10u32.to_le_bytes());
        assert_eq!(extract_subtitle(&lying, 0, 0), Err(ZipError::TooLarge));
    }

    #[test]
    fn crafted_offsets_are_rejected_without_panicking() {
        let zip = make_zip(&[("a.srt", SRT, false)]);
        let cd = zip.len() - 22 - (46 + "a.srt".len());
        // Local header offset near u32::MAX, huge compressed size, central dir past the end.
        let mut far = zip.clone();
        far[cd + 42..cd + 46].copy_from_slice(&0xFFFF_FFF0u32.to_le_bytes());
        assert_eq!(extract_subtitle(&far, 0, 0), Err(ZipError::Corrupt));
        let mut huge = zip.clone();
        huge[cd + 20..cd + 24].copy_from_slice(&0xFFFF_FFFEu32.to_le_bytes());
        assert_eq!(extract_subtitle(&huge, 0, 0), Err(ZipError::Corrupt));
        let mut bad_cd = zip.clone();
        let eocd = bad_cd.len() - 22;
        bad_cd[eocd + 16..eocd + 20].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        assert_eq!(extract_subtitle(&bad_cd, 0, 0), Err(ZipError::Corrupt));
        // Truncated central record (EOCD points 10 bytes before itself).
        let mut short = zip.clone();
        short[eocd + 16..eocd + 20].copy_from_slice(&((eocd - 10) as u32).to_le_bytes());
        assert_eq!(extract_subtitle(&short, 0, 0), Err(ZipError::Corrupt));
        assert!(ass_time_to_srt("9999999999999999:00:00.00").is_none());
    }

    #[test]
    fn decodes_charsets_and_converts_formats() {
        assert_eq!(decode_text(b"\xEF\xBB\xBFA\xC3\xB1o"), "Año");
        assert_eq!(decode_text(b"A\xF1o \xBFqu\xE9?"), "Año ¿qué?");
        let utf16: Vec<u8> = "Año -->".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let mut bom = vec![0xFF, 0xFE];
        bom.extend_from_slice(&utf16);
        assert_eq!(decode_text(&bom), "Año -->");
        assert_eq!(decode_text(&utf16), "Año -->");

        let vtt = "WEBVTT\n\nNOTE x\n\n00:01.500 --> 00:02.000 align:start\nHola\n\n1\n01:00:00.000 --> 01:00:01.250\nAdiós\n";
        assert_eq!(
            to_srt(vtt),
            "1\n00:00:01,500 --> 00:00:02,000\nHola\n\n2\n01:00:00,000 --> 01:00:01,250\nAdiós\n\n"
        );
        let ass = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n\
                   Dialogue: 0,0:00:05.10,0:00:06.00,Default,,0,0,0,,{\\i1}Segunda{\\i0}\\Nlínea, con coma\n\
                   Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Primera\n";
        assert_eq!(
            to_srt(ass),
            "1\n00:00:01,000 --> 00:00:02,500\nPrimera\n\n2\n00:00:05,100 --> 00:00:06,000\nSegunda\nlínea, con coma\n\n"
        );
        assert_eq!(to_srt("1\r\n00:00:01,000 --> 00:00:02,000\r\nHola\r\n"), "1\n00:00:01,000 --> 00:00:02,000\nHola\n");
    }
}
