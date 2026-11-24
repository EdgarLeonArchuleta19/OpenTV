use std::collections::HashMap;
use std::time::Duration;

use reqwest::header::{HeaderValue, RANGE};
use serde_json::{json, Value};

use crate::dnsx::Dnsx;
use crate::proxy::ProxyStore;
use crate::safe_http::{fetch_url, header_map_from, FetchOptions};

const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

fn looks_like_media_file(u: &str) -> bool {
    let path = u.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    let exts = [
        ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".mov", ".ts", ".m2ts", ".m3u8", ".mpd",
    ];
    exts.iter().any(|ext| path.ends_with(ext)) && !path.contains("/resolve/")
}

async fn follow_redirects(
    dns: &Dnsx,
    target_url: &str,
    base_url: &str,
    headers: &HashMap<String, String>,
    allow_lan: bool,
) -> (String, String, bool) {
    if !(target_url.starts_with("http://") || target_url.starts_with("https://"))
        || (!base_url.is_empty() && target_url.starts_with(base_url))
        || looks_like_media_file(target_url)
    {
        return (target_url.to_string(), String::new(), false);
    }

    let mut current = target_url.to_string();
    let mut detected_ct = String::new();
    let mut sniffed_hls = false;

    let mut hmap = header_map_from(headers);
    hmap.insert(RANGE, HeaderValue::from_static("bytes=0-63"));
    let mut opts = FetchOptions::new(dns, allow_lan, Duration::from_millis(4500));
    opts.headers = hmap;
    opts.user_agent = Some(DEFAULT_UA.to_string());

    // `fetch_url` checks NetGuard on every redirect hop and pins the validated
    // IP, so an open-source URL cannot bounce into the router or loopback.
    let Ok(mut resp) = fetch_url(&current, opts).await else {
        return (current, String::new(), false);
    };
    current = resp.url().to_string();

    if let Some(ct) = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        detected_ct = ct.to_ascii_lowercase();
    }
    // Sniff the first bytes for `#EXTM3U` so obfuscated HLS playlists
    // served as `.txt`, `.png`, or extensionless `text/plain` still play via hls.js.
    if resp.status().is_success() && !detected_ct.contains("mpegurl") {
        if let Ok(Ok(Some(chunk))) =
            tokio::time::timeout(Duration::from_millis(1200), resp.chunk()).await
        {
            let head = &chunk[..chunk.len().min(64)];
            let head_str = String::from_utf8_lossy(head);
            if head_str
                .trim_start_matches('\u{feff}')
                .trim_start()
                .starts_with("#EXTM3U")
            {
                sniffed_hls = true;
            }
        }
    }

    (current, detected_ct, sniffed_hls)
}

/// Port of `resolveExternal` from `service/index.js` & `OpenTvService.java`.
pub async fn resolve_external(
    dns: &Dnsx,
    proxy: &ProxyStore,
    base_url: &str,
    params: &Value,
) -> Result<Value, String> {
    let raw_url = params["url"].as_str().unwrap_or("");
    if !(raw_url.starts_with("http://") || raw_url.starts_with("https://")) {
        return Err("La fuente no tiene un enlace http(s) válido".to_string());
    }

    let mut headers = HashMap::new();
    if let Some(obj) = params["headers"].as_object() {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                if !k.contains(['\r', '\n']) && !s.contains(['\r', '\n']) {
                    headers.insert(k.clone(), s.to_string());
                }
            }
        }
    }
    let allow_lan = params["allowLan"].as_bool().unwrap_or(false)
        || params["allowLan"].as_str() == Some("true");
    let has_headers = !headers.is_empty();
    let force_proxy = params["forceProxy"].as_bool().unwrap_or(false)
        || params["forceProxy"].as_str() == Some("true");
    let use_proxy = has_headers || force_proxy;

    let (url, detected_ct, sniffed_hls) =
        follow_redirects(dns, raw_url, base_url, &headers, allow_lan).await;
    let probe_name = format!(
        "{} {}",
        params["name"].as_str().unwrap_or(""),
        url.split('?').next().unwrap_or("")
    )
    .to_ascii_lowercase();

    let is_hls = probe_name.contains(".m3u8") || detected_ct.contains("mpegurl") || sniffed_hls;
    if is_hls {
        if !use_proxy {
            return Ok(json!({
                "url": url,
                "resolvedUrl": url,
                "proxyPath": url,
                "isHls": true,
                "mime": "application/vnd.apple.mpegurl"
            }));
        }
        let token = proxy
            .add_media(url.clone(), headers, allow_lan)
            .await
            .map_err(|e| e)?;
        let proxy_path = format!("{base_url}/media/{token}/stream.m3u8");
        return Ok(json!({
            "url": url,
            "resolvedUrl": url,
            "proxyPath": proxy_path,
            "token": token,
            "isHls": true,
            "mime": "application/vnd.apple.mpegurl"
        }));
    }

    let (proxy_path, media_token) = if use_proxy {
        let token = proxy
            .add_media(url.clone(), headers, allow_lan)
            .await
            .map_err(|e| e)?;
        (format!("{base_url}/media/{token}/stream.mp4"), token)
    } else {
        (url.clone(), String::new())
    };

    Ok(json!({
        "url": url,
        "resolvedUrl": url,
        "proxyPath": proxy_path,
        "token": media_token,
        "mime": "video/mp4",
        "isHls": false
    }))
}
