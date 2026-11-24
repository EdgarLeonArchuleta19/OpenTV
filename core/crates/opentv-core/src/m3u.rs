use std::sync::OnceLock;
use std::time::Duration;

use futures_util::StreamExt;
use regex::Regex;
use serde::Serialize;

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, FetchOptions};

const M3U_MAX_BYTES: usize = 20 * 1024 * 1024;
const M3U_USER_AGENT: &str =
    "Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/538.1+ (KHTML, like Gecko) Safari/538.1+";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M3uChannel {
    pub name: String,
    pub logo: String,
    pub group: String,
    pub is_addon: bool,
    pub now: String,
    pub fav: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tvg_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg: Option<String>,
    pub url: String,
    pub stream_url: String,
    pub channel_code: String,
    pub index: usize,
}

fn re_epg() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)(?:url-tvg|x-tvg-url)="([^"]+)""#).unwrap())
}
fn re_logo() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)tvg-logo="([^"]+)""#).unwrap())
}
fn re_group() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)group-title="([^"]+)""#).unwrap())
}
fn re_id() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)tvg-id="([^"]+)""#).unwrap())
}

pub fn m3u_epg_url(line: &str) -> Option<String> {
    let caps = re_epg().captures(line)?;
    let first = caps.get(1)?.as_str().split(',').next()?.trim();
    if first.starts_with("http://") || first.starts_with("https://") {
        Some(first.to_string())
    } else {
        None
    }
}

/// Exact port of `parseM3u` from `service/m3u.js` and `M3u.java`.
pub fn parse_m3u(content: &str) -> Vec<M3uChannel> {
    let mut channels = Vec::new();
    let mut cur: Option<M3uChannel> = None;
    let mut epg: Option<String> = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.starts_with("#EXTM3U") {
            epg = m3u_epg_url(line);
        } else if let Some(rest) = line.strip_prefix("#EXTINF:") {
            let (meta, title) = match rest.find(',') {
                Some(idx) => (&rest[..idx], rest[idx + 1..].trim()),
                None => (rest, "Canal"),
            };
            let logo = re_logo()
                .captures(meta)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();
            let group = re_group()
                .captures(meta)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| "Addon".to_string());
            let tvg_id = re_id()
                .captures(meta)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string());

            cur = Some(M3uChannel {
                name: if title.is_empty() {
                    "Canal".to_string()
                } else {
                    title.to_string()
                },
                logo,
                group,
                is_addon: true,
                now: "En vivo".to_string(),
                fav: false,
                tvg_id,
                epg: epg.clone(),
                url: String::new(),
                stream_url: String::new(),
                channel_code: String::new(),
                index: 0,
            });
        } else if !line.is_empty() && !line.starts_with('#') {
            if let Some(mut ch) = cur.take() {
                let idx = channels.len() + 1;
                ch.url = line.to_string();
                ch.stream_url = line.to_string();
                ch.channel_code = format!("m3u_{idx}");
                ch.index = idx;
                channels.push(ch);
            }
        }
    }

    channels
}

pub async fn fetch_m3u(
    dns: &Dnsx,
    url_str: &str,
    allow_lan: bool,
) -> Result<Vec<M3uChannel>, String> {
    let trimmed = url_str.trim();
    if trimmed.is_empty() {
        return Err("URL de la lista requerida".to_string());
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("La lista debe ser una dirección http(s)".to_string());
    }

    let mut opts = FetchOptions::new(dns, allow_lan, Duration::from_secs(20));
    opts.user_agent = Some(M3U_USER_AGENT.to_string());
    let resp = fetch_url(trimmed, opts)
        .await
        .map_err(|e| format!("Error al descargar la lista: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {} al descargar la lista",
            resp.status().as_u16()
        ));
    }

    let mut bytes = Vec::with_capacity(64 * 1024);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Error leyendo la lista: {e}"))?;
        if bytes.len() + chunk.len() > M3U_MAX_BYTES {
            return Err("La lista es demasiado grande".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    let text = String::from_utf8_lossy(&bytes);
    Ok(parse_m3u(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_m3u_with_epg_and_attributes() {
        let sample = r#"#EXTM3U url-tvg="https://example.com/guide.xml.gz"
#EXTINF:-1 tvg-id="ch1.mx" tvg-logo="https://img/1.png" group-title="Noticias",Canal Uno
https://stream.example.com/live/1.m3u8
#EXTINF:-1,Canal Dos
https://stream.example.com/live/2.m3u8
"#;
        let chs = parse_m3u(sample);
        assert_eq!(chs.len(), 2);
        assert_eq!(chs[0].name, "Canal Uno");
        assert_eq!(chs[0].group, "Noticias");
        assert_eq!(chs[0].tvg_id.as_deref(), Some("ch1.mx"));
        assert_eq!(
            chs[0].epg.as_deref(),
            Some("https://example.com/guide.xml.gz")
        );
        assert_eq!(chs[0].channel_code, "m3u_1");
        assert_eq!(chs[1].group, "Addon");
        assert_eq!(chs[1].index, 2);
    }
}
