use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, HeaderMap as AxumHeaders, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::Response;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use flate2::read::GzDecoder;
use futures_util::TryStreamExt;
use rand::RngCore;
use reqwest::header::{
    HeaderMap as ReqHeaders, HeaderValue as ReqHeaderValue,
};
use tokio::sync::{watch, RwLock};
use url::Url;

use crate::dnsx::Dnsx;
use crate::netguard;
use crate::safe_http::{fetch_url, header_map_from, FetchOptions};

const MAX_MEDIA_TOKENS: usize = 12;
const MAX_SUBTITLE_TOKENS: usize = 60;
const MAX_M3U8_BYTES: usize = 4 * 1024 * 1024;
const HEADER_TIMEOUT_SECS: u64 = 22;
const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Clone, Debug)]
pub struct MediaEntry {
    pub url: String,
    pub headers: HashMap<String, String>,
    /// LAN permission is captured from the plugin that registered this token.
    pub allow_lan: bool,
    pub abort_tx: Arc<watch::Sender<u64>>,
}

#[derive(Clone, Debug)]
struct SubtitleEntry {
    url: String,
    allow_lan: bool,
}

/// Loopback media & subtitle proxy (full Rust port of `service/proxy.js` and `Proxy.java`,
/// including HLS `.m3u8` manifest rewriting to `/hls/<token>/<base64url>` so child playlists,
/// keys, init maps and segments keep all required `Referer`/`Cookie`/`User-Agent` headers).
#[derive(Clone)]
pub struct ProxyStore {
    dns: Dnsx,
    media: Arc<RwLock<HashMap<String, MediaEntry>>>,
    media_order: Arc<RwLock<VecDeque<String>>>,
    /// Tokens used only by the internal FFmpeg compatibility engine. Kept apart so they
    /// never evict, abort or take over the player's own stream token.
    passive_media: Arc<RwLock<HashMap<String, MediaEntry>>>,
    passive_order: Arc<RwLock<VecDeque<String>>>,
    active_token: Arc<RwLock<Option<String>>>,
    subtitles: Arc<RwLock<HashMap<String, SubtitleEntry>>>,
    sub_order: Arc<RwLock<VecDeque<String>>>,
}

fn rand_token(bytes_len: usize) -> String {
    let mut b = vec![0u8; bytes_len];
    rand::thread_rng().fill_bytes(&mut b);
    let mut out = String::with_capacity(bytes_len * 2);
    for byte in b {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

impl ProxyStore {
    pub fn new(dns: Dnsx) -> Self {
        // TLS verification is always enforced. A proxy that silently retries
        // with `danger_accept_invalid_certs` enables MITM of any stream.
        Self {
            dns,
            media: Arc::new(RwLock::new(HashMap::new())),
            media_order: Arc::new(RwLock::new(VecDeque::new())),
            passive_media: Arc::new(RwLock::new(HashMap::new())),
            passive_order: Arc::new(RwLock::new(VecDeque::new())),
            active_token: Arc::new(RwLock::new(None)),
            subtitles: Arc::new(RwLock::new(HashMap::new())),
            sub_order: Arc::new(RwLock::new(VecDeque::new())),
        }
    }

    /// Rejects loopback/LAN targets before a proxy token is ever handed out.
    async fn validate_target(&self, url: &str, allow_lan: bool) -> Result<(), String> {
        let parsed = Url::parse(url).map_err(|_| "Enlace no válido".to_string())?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err("Solo se permiten enlaces http(s)".to_string());
        }
        let host = parsed
            .host_str()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| "Host inválido".to_string())?;
        netguard::check(&self.dns, host, allow_lan).await?;
        Ok(())
    }

    pub async fn add_media(
        &self,
        url: String,
        headers: HashMap<String, String>,
        allow_lan: bool,
    ) -> Result<String, String> {
        self.validate_target(&url, allow_lan).await?;
        let token = rand_token(12);
        let (abort_tx, _rx) = watch::channel(0u64);
        {
            let mut map = self.media.write().await;
            let mut ord = self.media_order.write().await;
            map.insert(
                token.clone(),
                MediaEntry {
                    url,
                    headers,
                    allow_lan,
                    abort_tx: Arc::new(abort_tx),
                },
            );
            ord.push_back(token.clone());
            while ord.len() > MAX_MEDIA_TOKENS {
                if let Some(old) = ord.pop_front() {
                    if let Some(removed) = map.remove(&old) {
                        let next = removed.abort_tx.borrow().wrapping_add(1);
                        let _ = removed.abort_tx.send(next);
                    }
                }
            }
        }
        Ok(token)
    }

    /// Registers a NetGuard-checked upstream for the internal FFmpeg engine. Every
    /// request FFmpeg makes (ranges, redirects, HLS children, keys) then goes through
    /// `fetch_url`, which re-checks NetGuard on each hop and verifies TLS. Passive tokens
    /// do not switch or abort the player's active stream.
    pub async fn add_media_passive(
        &self,
        url: String,
        headers: HashMap<String, String>,
        allow_lan: bool,
    ) -> Result<String, String> {
        self.validate_target(&url, allow_lan).await?;
        {
            let map = self.passive_media.read().await;
            if let Some((tok, _)) = map
                .iter()
                .find(|(_, e)| e.url == url && e.headers == headers && e.allow_lan == allow_lan)
            {
                return Ok(tok.clone());
            }
        }
        let token = rand_token(12);
        let (abort_tx, _rx) = watch::channel(0u64);
        let mut map = self.passive_media.write().await;
        let mut ord = self.passive_order.write().await;
        map.insert(
            token.clone(),
            MediaEntry {
                url,
                headers,
                allow_lan,
                abort_tx: Arc::new(abort_tx),
            },
        );
        ord.push_back(token.clone());
        while ord.len() > MAX_MEDIA_TOKENS {
            if let Some(old) = ord.pop_front() {
                map.remove(&old);
            }
        }
        Ok(token)
    }

    /// Looks a media token up; the flag is true for an FFmpeg-only (passive) token.
    async fn lookup_media(&self, token: &str) -> Option<(MediaEntry, bool)> {
        if let Some(e) = self.media.read().await.get(token).cloned() {
            return Some((e, false));
        }
        self.passive_media
            .read()
            .await
            .get(token)
            .cloned()
            .map(|e| (e, true))
    }

    pub async fn add_subtitle(&self, url: String, allow_lan: bool) -> Result<String, String> {
        self.validate_target(&url, allow_lan).await?;
        let token = rand_token(10);
        {
            let mut map = self.subtitles.write().await;
            let mut ord = self.sub_order.write().await;
            map.insert(
                token.clone(),
                SubtitleEntry {
                    url,
                    allow_lan,
                },
            );
            ord.push_back(token.clone());
            while ord.len() > MAX_SUBTITLE_TOKENS {
                if let Some(old) = ord.pop_front() {
                    map.remove(&old);
                }
            }
        }
        Ok(token)
    }

    /// Cancels active upstream media streams immediately (`abortMedia`).
    /// When `except_token` is supplied (by `playUrl` stopping any earlier
    /// stream right before loading the new one), that token is spared so an
    /// asynchronous IPC `abortMedia` can never race and kill the new stream.
    pub async fn abort_all(&self, except_token: Option<&str>) {
        let senders: Vec<Arc<watch::Sender<u64>>> = {
            let map = self.media.read().await;
            map.iter()
                .filter(|(k, _)| except_token.map_or(true, |keep| k.as_str() != keep))
                .map(|(_, v)| v.abort_tx.clone())
                .collect()
        };
        for tx in senders {
            let next = tx.borrow().wrapping_add(1);
            let _ = tx.send(next);
        }
        let mut active = self.active_token.write().await;
        if active.as_deref() != except_token {
            *active = except_token.map(|s| s.to_string());
        }
    }

    async fn switch_active_token(&self, token: &str) {
        let prev = {
            let mut active = self.active_token.write().await;
            if active.as_deref() == Some(token) {
                return;
            }
            active.replace(token.to_string())
        };
        if let Some(old_tok) = prev {
            if let Some(entry) = self.media.read().await.get(&old_tok).cloned() {
                let next = entry.abort_tx.borrow().wrapping_add(1);
                let _ = entry.abort_tx.send(next);
            }
        }
    }

    pub async fn serve_media(
        &self,
        base_url: &str,
        method: &Method,
        token: &str,
        rest: &str,
        req_headers: &AxumHeaders,
    ) -> Response {
        let Some((entry, passive)) = self.lookup_media(token).await else {
            return plain_response(StatusCode::GONE, "Stream expirado");
        };
        if !passive {
            self.switch_active_token(token).await;
        }
        self.forward(
            base_url,
            method,
            token,
            &entry.url,
            &entry.headers,
            entry.allow_lan,
            &entry.abort_tx,
            rest,
            req_headers,
        )
        .await
    }

    pub async fn serve_hls_child(
        &self,
        base_url: &str,
        method: &Method,
        token: &str,
        encoded_url: &str,
        req_headers: &AxumHeaders,
    ) -> Response {
        let Some((entry, passive)) = self.lookup_media(token).await else {
            return plain_response(StatusCode::GONE, "Stream expirado");
        };
        let Ok(raw_bytes) = URL_SAFE_NO_PAD.decode(encoded_url.trim()) else {
            return plain_response(StatusCode::BAD_REQUEST, "Enlace HLS inválido");
        };
        let Ok(child_url) = String::from_utf8(raw_bytes) else {
            return plain_response(StatusCode::BAD_REQUEST, "Enlace HLS inválido");
        };
        if !(child_url.starts_with("http://") || child_url.starts_with("https://")) {
            return plain_response(StatusCode::BAD_REQUEST, "Solo http/https");
        }
        // HLS children come from an untrusted playlist: they get the same
        // NetGuard treatment as the original URL, scoped to this plugin's LAN flag.
        if let Err(e) = self.validate_target(&child_url, entry.allow_lan).await {
            return plain_response(StatusCode::FORBIDDEN, &e);
        }
        if !passive {
            self.switch_active_token(token).await;
        }
        self.forward(
            base_url,
            method,
            token,
            &child_url,
            &entry.headers,
            entry.allow_lan,
            &entry.abort_tx,
            "",
            req_headers,
        )
        .await
    }

    async fn forward(
        &self,
        base_url: &str,
        method: &Method,
        token: &str,
        target_url: &str,
        entry_headers: &HashMap<String, String>,
        allow_lan: bool,
        abort_tx: &Arc<watch::Sender<u64>>,
        rest: &str,
        req_headers: &AxumHeaders,
    ) -> Response {
        if *method == Method::OPTIONS {
            return with_cors(Response::builder())
                .status(StatusCode::NO_CONTENT)
                .header(header::ACCESS_CONTROL_MAX_AGE, "86400")
                .body(Body::empty())
                .unwrap();
        }

        // `header_map_from` drops CRLF-injected values; Host/Content-Length are
        // always recomputed by reqwest for the validated upstream address.
        let mut hmap: ReqHeaders = header_map_from(entry_headers);
        hmap.remove(reqwest::header::HOST);
        hmap.remove(reqwest::header::CONTENT_LENGTH);
        if !hmap.contains_key(reqwest::header::USER_AGENT) {
            hmap.insert(
                reqwest::header::USER_AGENT,
                ReqHeaderValue::from_static(DEFAULT_UA),
            );
        }
        if let Some(range) = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
            if let Ok(hv) = ReqHeaderValue::from_str(range) {
                hmap.insert(reqwest::header::RANGE, hv);
            }
        }
        if let Some(if_range) = req_headers
            .get(header::IF_RANGE)
            .and_then(|v| v.to_str().ok())
        {
            if let Ok(hv) = ReqHeaderValue::from_str(if_range) {
                hmap.insert(reqwest::header::IF_RANGE, hv);
            }
        }

        // Timeout ONLY waiting for upstream headers — NEVER kill an ongoing video stream after 22s!
        // Subscribe directly to this token's watch::Sender so the receiver starts marked-seen at the
        // current value and only fires if abort_all() cancels this token AFTER this request starts.
        let mut abort_rx = abort_tx.subscribe();
        let mut opts = FetchOptions::new(
            &self.dns,
            allow_lan,
            Duration::from_secs(HEADER_TIMEOUT_SECS),
        );
        opts.streaming = true; // the body must not be killed by the header timeout
        opts.method = if *method == Method::HEAD {
            reqwest::Method::HEAD
        } else {
            reqwest::Method::GET
        };
        opts.headers = hmap;
        let send_fut = tokio::time::timeout(
            Duration::from_secs(HEADER_TIMEOUT_SECS),
            fetch_url(target_url, opts),
        );

        let upstream = tokio::select! {
            _ = abort_rx.changed() => {
                return plain_response(StatusCode::SERVICE_UNAVAILABLE, "Abortado");
            }
            res = send_fut => match res {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => return plain_response(StatusCode::BAD_GATEWAY, &format!("Error upstream: {e}")),
                Err(_) => return plain_response(StatusCode::GATEWAY_TIMEOUT, "Tiempo agotado upstream"),
            }
        };

        let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::OK);
        let final_url = upstream.url().to_string();
        let raw_mime = upstream
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();

        let is_m3u8 = raw_mime.contains("mpegurl")
            || final_url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase().ends_with(".m3u8")
            || target_url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase().ends_with(".m3u8")
            || rest.to_ascii_lowercase().ends_with(".m3u8");
        let maybe_text_m3u8 = raw_mime.starts_with("text/")
            && upstream
                .content_length()
                .map_or(true, |n| n <= MAX_M3U8_BYTES as u64);

        if *method == Method::HEAD {
            let mut builder = with_cors(Response::builder()).status(status);
            for hdr in [
                "content-type",
                "content-length",
                "content-range",
                "accept-ranges",
            ] {
                if let Some(val) = upstream.headers().get(hdr).and_then(|v| v.to_str().ok()) {
                    if let (Ok(hn), Ok(hv)) = (
                        HeaderName::from_bytes(hdr.as_bytes()),
                        HeaderValue::from_str(val),
                    ) {
                        builder = builder.header(hn, hv);
                    }
                }
            }
            return builder.body(Body::empty()).unwrap();
        }

        if (is_m3u8 || maybe_text_m3u8) && status.is_success() {
            let body_bytes = match tokio::time::timeout(
                Duration::from_secs(20),
                upstream.bytes(),
            )
            .await
            {
                Ok(Ok(b)) if b.len() <= MAX_M3U8_BYTES => b,
                _ => return plain_response(StatusCode::BAD_GATEWAY, "No se pudo leer la lista HLS"),
            };
            let text = String::from_utf8_lossy(&body_bytes);
            // Only rewrite if it actually looks like an M3U8 playlist (guards against mislabeled TS).
            if text.trim_start_matches('\u{feff}').trim_start().starts_with("#EXTM3U") {
                let rewritten = rewrite_hls_manifest(&text, base_url, token, &final_url);
                let out_bytes = rewritten.into_bytes();
                return with_cors(Response::builder())
                    .status(status)
                    .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
                    .header(header::CONTENT_LENGTH, out_bytes.len().to_string())
                    .header(header::CACHE_CONTROL, "no-cache, no-store")
                    .body(Body::from(out_bytes))
                    .unwrap();
            }
            return with_cors(Response::builder())
                .status(status)
                .header(header::CONTENT_TYPE, if raw_mime.is_empty() { "application/octet-stream" } else { &raw_mime })
                .header(header::CONTENT_LENGTH, body_bytes.len().to_string())
                .body(Body::from(body_bytes))
                .unwrap();
        }

        let mut builder = with_cors(Response::builder())
            .status(status)
            .header(header::CACHE_CONTROL, "private, max-age=120");

        for hdr in [
            "content-type",
            "content-length",
            "content-range",
            "accept-ranges",
        ] {
            if let Some(val) = upstream.headers().get(hdr).and_then(|v| v.to_str().ok()) {
                if let (Ok(hn), Ok(hv)) = (
                    HeaderName::from_bytes(hdr.as_bytes()),
                    HeaderValue::from_str(val),
                ) {
                    builder = builder.header(hn, hv);
                }
            }
        }

        let stream = upstream
            .bytes_stream()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e));
        builder.body(Body::from_stream(stream)).unwrap()
    }

    pub async fn serve_subtitle(&self, raw_token: &str) -> Response {
        let token = raw_token.trim_end_matches(".srt");
        let Some(entry) = self.subtitles.read().await.get(token).cloned() else {
            return plain_response(StatusCode::NOT_FOUND, "Subtítulo no encontrado");
        };

        let mut opts = FetchOptions::new(&self.dns, entry.allow_lan, Duration::from_secs(15));
        opts.user_agent = Some(DEFAULT_UA.to_string());
        let resp = match fetch_url(&entry.url, opts).await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                return plain_response(
                    StatusCode::BAD_GATEWAY,
                    &format!("HTTP {}", r.status().as_u16()),
                );
            }
            Err(e) => {
                return plain_response(
                    StatusCode::BAD_GATEWAY,
                    &format!("Error subtítulo: {e}"),
                );
            }
        };

        let raw = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                return plain_response(
                    StatusCode::BAD_GATEWAY,
                    &format!("Lectura subtítulo: {e}"),
                );
            }
        };

        let decoded_bytes: Vec<u8> = if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
            let mut dec = GzDecoder::new(&raw[..]);
            let mut out = Vec::new();
            if dec.read_to_end(&mut out).is_ok() {
                out
            } else {
                raw.to_vec()
            }
        } else {
            raw.to_vec()
        };

        let text = decode_subtitle_text(&decoded_bytes);

        with_cors(Response::builder())
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(header::CACHE_CONTROL, "private, max-age=300")
            .body(Body::from(text))
            .unwrap()
    }
}

fn with_cors(mut b: axum::http::response::Builder) -> axum::http::response::Builder {
    b = b
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET,HEAD,OPTIONS")
        .header(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            "Range, Content-Type, Accept, Origin",
        )
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Length, Content-Range, Accept-Ranges, Content-Type",
        );
    b
}

fn plain_response(status: StatusCode, msg: &str) -> Response {
    with_cors(Response::builder())
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(msg.to_string()))
        .unwrap()
}

fn hls_child_url(base_url: &str, token: &str, manifest_url: &Url, reference: &str) -> String {
    let trimmed = reference.trim();
    if trimmed.is_empty() || trimmed.starts_with("data:") {
        return trimmed.to_string();
    }
    let resolved = match manifest_url.join(trimmed) {
        Ok(u) => u.to_string(),
        Err(_) => trimmed.to_string(),
    };
    let encoded = URL_SAFE_NO_PAD.encode(resolved.as_bytes());
    format!("{base_url}/hls/{token}/{encoded}")
}

/// Exact port of `service/proxy.js#rewriteHlsManifest`:
/// Rewrites every segment URI, sub-playlist URI, and `URI="..."` attribute (keys, maps, audio/sub tracks)
/// to flow through `/hls/<token>/<base64url>` so custom headers (`Referer`, `Cookie`, `User-Agent`) stay attached.
pub fn rewrite_hls_manifest(body: &str, base_url: &str, token: &str, manifest_url_str: &str) -> String {
    let Ok(manifest_url) = Url::parse(manifest_url_str) else {
        return body.to_string();
    };
    let clean = body.strip_prefix('\u{feff}').unwrap_or(body);
    let mut out = Vec::new();
    for raw_line in clean.lines() {
        let line = raw_line.trim_end_matches('\r');
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push(String::new());
        } else if !trimmed.starts_with('#') {
            out.push(hls_child_url(base_url, token, &manifest_url, trimmed));
        } else if line.contains("URI=") {
            out.push(rewrite_uri_attrs(line, base_url, token, &manifest_url));
        } else {
            out.push(line.to_string());
        }
    }
    out.join("\n") + "\n"
}

fn rewrite_uri_attrs(line: &str, base_url: &str, token: &str, manifest_url: &Url) -> String {
    let mut result = String::with_capacity(line.len() + 64);
    let mut rest = line;
    while let Some(pos) = rest.find("URI=") {
        result.push_str(&rest[..pos + 4]);
        rest = &rest[pos + 4..];
        if let Some(quote) = rest.chars().next().filter(|&c| c == '"' || c == '\'') {
            result.push(quote);
            rest = &rest[1..];
            if let Some(end) = rest.find(quote) {
                let reference = &rest[..end];
                result.push_str(&hls_child_url(base_url, token, manifest_url, reference));
                result.push(quote);
                rest = &rest[end + 1..];
            }
        }
    }
    result.push_str(rest);
    result
}

fn decode_subtitle_text(bytes: &[u8]) -> String {
    let data = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if let Ok(s) = std::str::from_utf8(data) {
        return s.to_string();
    }
    let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(data);
    cow.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_hls_manifest_segments_and_uri_attributes() {
        let m3u8 = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6.0,\nseg01.ts\nhttps://other.cdn/seg02.ts\n";
        let rewritten = rewrite_hls_manifest(
            m3u8,
            "http://127.0.0.1:8910",
            "abc123",
            "https://stream.example/v1/master.m3u8",
        );
        let key_enc = URL_SAFE_NO_PAD.encode("https://stream.example/v1/key.bin");
        let map_enc = URL_SAFE_NO_PAD.encode("https://stream.example/v1/init.mp4");
        let seg1_enc = URL_SAFE_NO_PAD.encode("https://stream.example/v1/seg01.ts");
        let seg2_enc = URL_SAFE_NO_PAD.encode("https://other.cdn/seg02.ts");

        assert!(rewritten.contains(&format!("URI=\"http://127.0.0.1:8910/hls/abc123/{key_enc}\"")));
        assert!(rewritten.contains(&format!("URI=\"http://127.0.0.1:8910/hls/abc123/{map_enc}\"")));
        assert!(rewritten.contains(&format!("\nhttp://127.0.0.1:8910/hls/abc123/{seg1_enc}\n")));
        assert!(rewritten.contains(&format!("\nhttp://127.0.0.1:8910/hls/abc123/{seg2_enc}\n")));
    }
}
