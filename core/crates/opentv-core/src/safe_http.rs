use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use reqwest::redirect::Policy;
use reqwest::{Method, Response};
use url::Url;

use crate::dnsx::Dnsx;
use crate::netguard;

/// Options for an outbound fetch that must obey NetGuard on every hop.
pub struct FetchOptions<'a> {
    pub dns: &'a Dnsx,
    pub allow_lan: bool,
    /// Connect timeout. Also used as the total timeout unless `streaming` is set.
    pub timeout: Duration,
    /// Media proxies only wait for headers with their own timeout; reqwest must
    /// not kill the response body stream after a few seconds.
    pub streaming: bool,
    pub method: Method,
    pub headers: HeaderMap,
    pub body: Option<Vec<u8>>,
    pub user_agent: Option<String>,
    pub max_redirects: usize,
}

impl<'a> FetchOptions<'a> {
    pub fn new(dns: &'a Dnsx, allow_lan: bool, timeout: Duration) -> Self {
        Self {
            dns,
            allow_lan,
            timeout,
            streaming: false,
            method: Method::GET,
            headers: HeaderMap::new(),
            body: None,
            user_agent: None,
            max_redirects: 5,
        }
    }
}

/// Converts plugin/user headers into a safe `HeaderMap`, dropping CRLF injection.
pub fn header_map_from(raw: &HashMap<String, String>) -> HeaderMap {
    let mut out = HeaderMap::new();
    for (k, v) in raw {
        if v.contains(['\r', '\n', '\0']) {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            out.insert(name, value);
        }
    }
    out
}

/// Fetches `url` with NetGuard enforced on the initial request AND on every
/// redirect. The connection is pinned to the exact IP NetGuard validated, so a
/// hostname that changes its DNS answer mid-flight cannot reach loopback/LAN.
pub async fn fetch_url(url: &str, mut opts: FetchOptions<'_>) -> Result<Response, String> {
    if let Some(ua) = opts.user_agent.take() {
        if !opts.headers.contains_key(USER_AGENT) {
            let value = HeaderValue::from_str(&ua).map_err(|e| e.to_string())?;
            opts.headers.insert(USER_AGENT, value);
        }
    }

    let mut current = url.trim().to_string();
    let mut method = opts.method;
    let mut body = opts.body;

    for _ in 0..=opts.max_redirects {
        let parsed = Url::parse(&current).map_err(|_| "Dirección no válida".to_string())?;
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err("Solo se permiten enlaces http(s)".to_string());
        }
        let host = parsed
            .host_str()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| "Host inválido".to_string())?;
        let pinned_ip = netguard::check(opts.dns, host, opts.allow_lan).await?;
        let port = parsed
            .port_or_known_default()
            .unwrap_or(if parsed.scheme() == "https" { 443 } else { 80 });

        let mut builder = reqwest::Client::builder()
            .redirect(Policy::none())
            .connect_timeout(opts.timeout.min(Duration::from_secs(10)))
            .tcp_nodelay(true);
        if !opts.streaming {
            builder = builder.timeout(opts.timeout);
        }
        // Literal IPs need no override; hostnames are pinned so DNS rebinding
        // between check() and connect() cannot bypass NetGuard.
        if host.parse::<IpAddr>().is_err() {
            builder = builder.resolve(host, SocketAddr::new(pinned_ip, port));
        }
        let client = builder.build().map_err(|e| e.to_string())?;

        let mut req = client
            .request(method.clone(), current.as_str())
            .headers(opts.headers.clone());
        if let Some(ref bytes) = body {
            req = req.body(bytes.clone());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("No se pudo conectar: {e}"))?;

        let status = resp.status().as_u16();
        if (300..400).contains(&status) {
            if let Some(loc) = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
            {
                if opts.max_redirects == 0 {
                    return Ok(resp);
                }
                let next = parsed.join(loc).map_err(|_| "Redirección inválida".to_string())?;
                if next.scheme() != "http" && next.scheme() != "https" {
                    return Err("Redirección a un protocolo no permitido".to_string());
                }
                if status == 303 || ((status == 301 || status == 302) && method == Method::POST) {
                    method = Method::GET;
                    body = None;
                }
                current = next.to_string();
                continue;
            }
        }
        return Ok(resp);
    }

    Err("Demasiadas redirecciones".to_string())
}
