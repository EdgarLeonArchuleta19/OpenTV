use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine;
use futures_util::StreamExt;
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use serde_json::{json, Value};
use url::Url;

use crate::dnsx::Dnsx;
use crate::netguard;
use crate::safe_http::{fetch_url, FetchOptions};

const MAX_PLUGIN_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_UA: &str =
    "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

/// Exact port of `pluginFetch` from `service/index.js` and `OpenTvService.java`.
/// Every hop (initial request + each redirect up to 5) is checked by `netguard::check`
/// and pinned to that exact resolved IP address via `ClientBuilder::resolve`.
pub async fn plugin_fetch(dns: &Dnsx, params: &Value) -> Value {
    let target_url = params["url"].as_str().unwrap_or("").trim().to_string();
    if !(target_url.starts_with("http://") || target_url.starts_with("https://")) {
        return err_obj(&target_url, "URL no válida");
    }

    let mut method = params["method"]
        .as_str()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let req_headers = params["headers"].as_object().cloned().unwrap_or_default();
    let mut body: Option<Vec<u8>> = if let Some(b64) = params["bodyBase64"].as_str() {
        base64::engine::general_purpose::STANDARD.decode(b64).ok()
    } else {
        params["body"].as_str().map(|s| s.as_bytes().to_vec())
    };
    let follow = params["redirect"].as_str() != Some("manual");
    let timeout_ms = params["timeoutMs"]
        .as_u64()
        .unwrap_or(12_000)
        .clamp(1500, 25_000);
    let allow_lan = params["allowLan"].as_bool().unwrap_or(false)
        || params["allowLan"].as_str() == Some("true");
    // `maxBytes` lets a plugin peek at a stream (Range probe) without pulling 2 MB.
    let max_bytes = params["maxBytes"]
        .as_u64()
        .map(|n| (n as usize).clamp(1, MAX_PLUGIN_BYTES))
        .unwrap_or(MAX_PLUGIN_BYTES);

    let mut current_url = target_url;

    for depth in 0..=5 {
        let parsed = match Url::parse(&current_url) {
            Ok(u) if u.scheme() == "http" || u.scheme() == "https" => u,
            _ => return err_obj(&current_url, "URL no válida"),
        };
        let host = match parsed.host_str() {
            Some(h) if !h.is_empty() => h.to_string(),
            _ => return err_obj(&current_url, "Host inválido"),
        };
        let port = parsed.port_or_known_default().unwrap_or(80);

        // NetGuard check + IP pinning. Try each validated address in turn (IPv4 first):
        // a connect failure on one address (e.g. unroutable IPv6) falls back to the next.
        let pinned_ips = match netguard::check_all(dns, &host, allow_lan).await {
            Ok(ips) => ips,
            Err(e) => return err_code(&current_url, &e, "host_not_allowed"),
        };

        let mut hmap = HeaderMap::new();
        hmap.insert(
            reqwest::header::USER_AGENT,
            HeaderValue::from_static(DEFAULT_UA),
        );
        for (k, v) in &req_headers {
            // reqwest negotiates and decodes gzip/deflate itself; a plugin-chosen
            // encoding (e.g. `br`) would hand the plugin undecoded bytes.
            if k.eq_ignore_ascii_case("accept-encoding") {
                continue;
            }
            if let Some(val_str) = v.as_str() {
                if let (Ok(hn), Ok(hv)) = (
                    HeaderName::from_bytes(k.as_bytes()),
                    HeaderValue::from_str(val_str),
                ) {
                    hmap.insert(hn, hv);
                }
            }
        }
        let req_method = reqwest::Method::from_bytes(method.as_bytes())
            .unwrap_or(reqwest::Method::GET);

        let mut last_err: Option<reqwest::Error> = None;
        let mut sent = None;
        for pinned_ip in pinned_ips.iter().take(4) {
            let client = match reqwest::Client::builder()
                .redirect(Policy::none())
                .timeout(Duration::from_millis(timeout_ms))
                .connect_timeout(Duration::from_millis(timeout_ms.min(5_000)))
                .resolve(&host, SocketAddr::new(*pinned_ip, port))
                .build()
            {
                Ok(c) => c,
                Err(e) => return err_obj(&current_url, &e.to_string()),
            };
            let mut rb = client
                .request(req_method.clone(), current_url.as_str())
                .headers(hmap.clone());
            if let Some(ref b) = body {
                rb = rb.body(b.clone());
            }
            match rb.send().await {
                Ok(r) => {
                    sent = Some(r);
                    break;
                }
                // Only an unreachable address is worth another try; anything else is final.
                Err(e) if e.is_connect() => last_err = Some(e),
                Err(e) => {
                    last_err = Some(e);
                    break;
                }
            }
        }
        let resp = match sent {
            Some(r) => r,
            None => {
                let e = last_err.expect("at least one attempt");
                if e.is_timeout() {
                    return err_code(&current_url, "Timeout", "timeout");
                }
                return err_code(&current_url, &e.to_string(), "network");
            }
        };

        let status = resp.status().as_u16();
        if follow && (300..400).contains(&status) {
            if let Some(loc) = resp.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()) {
                if depth == 5 {
                    return err_obj(&current_url, "Demasiadas redirecciones");
                }
                if let Ok(next) = parsed.join(loc) {
                    if status != 307 && status != 308 {
                        method = "GET".to_string();
                        body = None;
                    }
                    current_url = next.to_string();
                    continue;
                }
            }
        }

        let mut out_headers: HashMap<String, String> = HashMap::new();
        let mut set_cookies: Vec<String> = Vec::new();
        for (name, val) in resp.headers() {
            let key = name.as_str().to_ascii_lowercase();
            let val_s = val.to_str().unwrap_or("").to_string();
            if key == "set-cookie" {
                set_cookies.push(val_s);
            } else {
                out_headers
                    .entry(key)
                    .and_modify(|e| {
                        e.push_str(", ");
                        e.push_str(&val_s);
                    })
                    .or_insert(val_s);
            }
        }
        if !set_cookies.is_empty() {
            out_headers.insert("set-cookie".to_string(), set_cookies.join("\n"));
        }

        let mut data = Vec::new();
        let mut stream = resp.bytes_stream();
        while let Some(Ok(chunk)) = stream.next().await {
            if data.len() >= max_bytes {
                break;
            }
            let take = (max_bytes - data.len()).min(chunk.len());
            data.extend_from_slice(&chunk[..take]);
        }

        let text = String::from_utf8_lossy(&data).into_owned();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        return json!({
            "ok": (200..300).contains(&status),
            "status": status,
            "url": current_url,
            "headers": out_headers,
            "setCookies": set_cookies,
            "text": text,
            "base64": b64
        });
    }

    err_obj(&current_url, "Demasiadas redirecciones")
}

fn err_obj(url: &str, msg: &str) -> Value {
    err_code(url, msg, "network")
}

/// Transport failure (`status: 0`). `code` follows the Kino error codes
/// (`timeout`, `host_not_allowed`, `network`) so the sandbox can reject with it.
fn err_code(url: &str, msg: &str, code: &str) -> Value {
    json!({
        "ok": false,
        "status": 0,
        "url": url,
        "headers": {},
        "text": "",
        "error": msg,
        "code": code
    })
}

fn re_aftv_href() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)href=["'](https?://[^"'<>]+)["']"#).unwrap())
}

/// Resolves Downloader numeric codes (`aftv.news/N`), `!abc` (`py.md/abc`) and `abc` (`cutt.ly/abc`).
pub async fn resolve_short_code(dns: &Dnsx, code: &str) -> Result<String, String> {
    let trimmed = code.trim();
    if trimmed.is_empty() {
        return Err("Código vacío".to_string());
    }
    let start_url = if (4..=9).contains(&trimmed.len()) && trimmed.chars().all(|c| c.is_ascii_digit()) {
        format!("https://aftv.news/{trimmed}")
    } else if let Some(rest) = trimmed.strip_prefix('!') {
        let enc: String = url::form_urlencoded::byte_serialize(rest.as_bytes()).collect();
        format!("https://py.md/{enc}")
    } else if (2..=48).contains(&trimmed.len())
        && trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        format!("https://cutt.ly/{trimmed}")
    } else {
        return Err("Código corto no válido".to_string());
    };

    let mut current = start_url;
    for _ in 0..6 {
        let mut opts = FetchOptions::new(dns, false, Duration::from_secs(7));
        opts.user_agent = Some(DEFAULT_UA.to_string());
        let resp = fetch_url(&current, opts)
            .await
            .map_err(|e| format!("No se pudo resolver el código: {e}"))?;
        current = resp.url().to_string();
        let body = resp.text().await.unwrap_or_default();

        let final_host = Url::parse(&current)
            .ok()
            .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
            .unwrap_or_default();
        if final_host.contains("aftvnews.com") {
            for cap in re_aftv_href().captures_iter(&body) {
                if let Some(m) = cap.get(1) {
                    let href = m.as_str();
                    if !href.to_ascii_lowercase().contains("aftvnews.com") {
                        // The discovered link must pass NetGuard before it is
                        // handed back to a player/plugin.
                        let parsed = Url::parse(href).map_err(|_| "Enlace no válido".to_string())?;
                        let host = parsed
                            .host_str()
                            .ok_or_else(|| "Enlace no válido".to_string())?;
                        netguard::check(dns, host, false).await?;
                        return Ok(href.to_string());
                    }
                }
            }
        }
        return Ok(current);
    }

    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn refused_hosts_come_back_with_kino_error_codes() {
        let dns = Dnsx::new();
        let res = plugin_fetch(&dns, &json!({ "url": "http://127.0.0.1:9/x" })).await;
        assert_eq!(res["ok"], false);
        assert_eq!(res["status"], 0);
        assert_eq!(res["code"], "host_not_allowed");

        let res = plugin_fetch(&dns, &json!({ "url": "file:///c:/x" })).await;
        assert_eq!(res["code"], "network");
        assert!(res["error"].as_str().unwrap_or("").contains("URL"));
    }
}
