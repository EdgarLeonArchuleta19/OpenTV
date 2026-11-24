use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use futures_util::StreamExt;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use tokio::sync::RwLock;

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, FetchOptions};

const EPG_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const EPG_FAIL_TTL: Duration = Duration::from_secs(10 * 60);
const EPG_AHEAD_MS: i64 = 12 * 60 * 60 * 1000;
const EPG_PER_CHANNEL: usize = 10;
const EPG_ANSWER_PER_CHANNEL: usize = 3;
const EPG_SCHEDULE_MAX: usize = 60;
const EPG_SCHEDULE_CACHE: usize = 12;
const EPG_MAX_IDS: usize = 4000;
const EPG_MAX_DOWNLOAD_BYTES: usize = 40 * 1024 * 1024;
const TITLE_MAX: usize = 120;
const DESC_MAX: usize = 220;

#[derive(Clone, Debug, Serialize)]
pub struct EpgProgramme {
    pub s: i64,
    pub e: i64,
    pub t: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub d: Option<String>,
}

struct GuideEntry {
    at: Instant,
    failed: Option<String>,
    by_id: HashMap<String, Vec<EpgProgramme>>,
}

struct ScheduleEntry {
    at: Instant,
    list: Vec<EpgProgramme>,
}

/// Streaming XMLTV guide loader & cache (memory-flat for 1 GB Fire TV).
#[derive(Clone)]
pub struct EpgStore {
    dns: Dnsx,
    guides: Arc<RwLock<HashMap<String, Arc<GuideEntry>>>>,
    schedules: Arc<RwLock<HashMap<String, ScheduleEntry>>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Parses XMLTV timestamp `"20261119050428 +0000"` into epoch milliseconds.
pub fn xmltv_time(text: &str) -> i64 {
    let s = text.trim();
    let bytes = s.as_bytes();
    if bytes.len() < 12 {
        return 0;
    }
    let parse_u = |range: std::ops::Range<usize>| -> Option<i64> {
        s.get(range)?.parse::<i64>().ok()
    };
    let year = match parse_u(0..4) {
        Some(v) => v,
        None => return 0,
    };
    let month = match parse_u(4..6) {
        Some(v) if (1..=12).contains(&v) => v,
        _ => return 0,
    };
    let day = match parse_u(6..8) {
        Some(v) if (1..=31).contains(&v) => v,
        _ => return 0,
    };
    let hour = match parse_u(8..10) {
        Some(v) if v <= 23 => v,
        _ => return 0,
    };
    let min = match parse_u(10..12) {
        Some(v) if v <= 59 => v,
        _ => return 0,
    };
    let (sec, rest_start) = if bytes.len() >= 14 && bytes[12].is_ascii_digit() && bytes[13].is_ascii_digit() {
        (parse_u(12..14).unwrap_or(0).min(59), 14)
    } else {
        (0, 12)
    };

    let days = days_from_civil(year, month, day);
    let mut epoch_sec = days * 86_400 + hour * 3600 + min * 60 + sec;

    let tz = s[rest_start..].trim();
    if tz.len() >= 3 {
        let sign = match tz.as_bytes()[0] {
            b'+' => Some(1i64),
            b'-' => Some(-1i64),
            _ => None,
        };
        if let Some(sgn) = sign {
            let tz_h = tz.get(1..3).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
            let tz_m = tz.get(3..5).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0);
            epoch_sec -= sgn * (tz_h * 3600 + tz_m * 60);
        }
    }

    epoch_sec * 1000
}

/// Howard Hinnant's civil-to-days algorithm (days since 1970-01-01).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn clean_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len().min(256));
    let mut last_space = true;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !last_space {
                out.push(' ');
                last_space = true;
            }
        } else {
            out.push(ch);
            last_space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

fn clip(s: &str, max: usize) -> String {
    let cleaned = clean_ws(s);
    if cleaned.chars().count() <= max {
        return cleaned;
    }
    let truncated: String = cleaned.chars().take(max - 1).collect();
    let trimmed = truncated.trim_end_matches(|c: char| !c.is_whitespace()).trim_end();
    if trimmed.is_empty() {
        format!("{truncated}…")
    } else {
        format!("{trimmed}…")
    }
}

/// Parses an XMLTV stream (plain XML or gzipped) using `quick-xml` with constant memory.
pub fn parse_xmltv_bytes(
    raw: &[u8],
    now: i64,
    only_channel: Option<&str>,
    cap: usize,
) -> HashMap<String, Vec<EpgProgramme>> {
    let is_gzip = raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b;
    let reader: Box<dyn Read> = if is_gzip {
        Box::new(GzDecoder::new(raw))
    } else {
        Box::new(raw)
    };
    parse_xmltv_reader(BufReader::new(reader), now, only_channel, cap)
}

fn parse_xmltv_reader<R: std::io::BufRead>(
    input: R,
    now: i64,
    only_channel: Option<&str>,
    cap: usize,
) -> HashMap<String, Vec<EpgProgramme>> {
    let mut xml = Reader::from_reader(input);
    xml.config_mut().trim_text(false);
    xml.config_mut().check_end_names = false;

    let until = now + EPG_AHEAD_MS;
    let mut by_id: HashMap<String, Vec<EpgProgramme>> = HashMap::new();
    let mut buf = Vec::with_capacity(4096);

    let mut in_prog = false;
    let mut cur_ch = String::new();
    let mut cur_s: i64 = 0;
    let mut cur_e: i64 = 0;
    let mut cur_title = String::new();
    let mut cur_desc = String::new();
    let mut field = 0u8; // 0 = none, 1 = title, 2 = desc

    loop {
        buf.clear();
        match xml.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = e.name();
                match name.as_ref() {
                    b"programme" => {
                        let mut ch = String::new();
                        let mut s_val = 0i64;
                        let mut e_val = 0i64;
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"channel" => {
                                    ch = attr.unescape_value().map(|v| v.into_owned()).unwrap_or_default();
                                }
                                b"start" => {
                                    if let Ok(v) = attr.unescape_value() {
                                        s_val = xmltv_time(&v);
                                    }
                                }
                                b"stop" => {
                                    if let Ok(v) = attr.unescape_value() {
                                        e_val = xmltv_time(&v);
                                    }
                                }
                                _ => {}
                            }
                        }
                        let ch_match = only_channel.map(|want| want == ch).unwrap_or(true);
                        if !ch.is_empty() && ch_match && s_val > 0 && e_val > now && s_val < until {
                            in_prog = true;
                            cur_ch = ch;
                            cur_s = s_val;
                            cur_e = e_val;
                            cur_title.clear();
                            cur_desc.clear();
                            field = 0;
                        } else {
                            in_prog = false;
                        }
                    }
                    b"title" if in_prog && cur_title.is_empty() => field = 1,
                    b"desc" if in_prog && cur_desc.is_empty() => field = 2,
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) if in_prog && field != 0 => {
                if let Ok(t) = e.unescape() {
                    if field == 1 {
                        cur_title.push_str(&t);
                    } else if field == 2 {
                        cur_desc.push_str(&t);
                    }
                }
            }
            Ok(Event::CData(ref e)) if in_prog && field != 0 => {
                let t = String::from_utf8_lossy(e.as_ref());
                if field == 1 {
                    cur_title.push_str(&t);
                } else if field == 2 {
                    cur_desc.push_str(&t);
                }
            }
            Ok(Event::End(ref e)) => match e.name().as_ref() {
                b"title" | b"desc" => field = 0,
                b"programme" if in_prog => {
                    in_prog = false;
                    field = 0;
                    let list = by_id.entry(std::mem::take(&mut cur_ch)).or_default();
                    if list.len() < cap * 2 {
                        let title = clip(&cur_title, TITLE_MAX);
                        let desc = clip(&cur_desc, DESC_MAX);
                        list.push(EpgProgramme {
                            s: cur_s,
                            e: cur_e,
                            t: if title.is_empty() {
                                "Programa".to_string()
                            } else {
                                title
                            },
                            d: if desc.is_empty() { None } else { Some(desc) },
                        });
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    for list in by_id.values_mut() {
        list.sort_by_key(|p| p.s);
        if list.len() > cap {
            list.truncate(cap);
        }
    }

    by_id
}

impl EpgStore {
    pub fn new(dns: Dnsx) -> Self {
        Self {
            dns,
            guides: Arc::new(RwLock::new(HashMap::new())),
            schedules: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn download_bytes(&self, url: &str, allow_lan: bool) -> Result<Vec<u8>, String> {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("La guía debe ser una dirección http(s)".to_string());
        }
        // `allow_lan` only when the playlist that points at this guide was allowed on the
        // home network (same per-list permission as fetchM3u).
        let mut opts = FetchOptions::new(&self.dns, allow_lan, Duration::from_secs(30));
        opts.user_agent = Some("Mozilla/5.0 (OpenTV)".to_string());
        let resp = fetch_url(url, opts)
            .await
            .map_err(|e| format!("Error al descargar la guía: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {} al descargar la guía", resp.status().as_u16()));
        }
        let mut out = Vec::with_capacity(256 * 1024);
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Error leyendo la guía: {e}"))?;
            if out.len() + chunk.len() > EPG_MAX_DOWNLOAD_BYTES {
                return Err("La guía es demasiado grande".to_string());
            }
            out.extend_from_slice(&chunk);
        }
        Ok(out)
    }

    async fn load_guide(&self, url: &str, allow_lan: bool) -> Result<Arc<GuideEntry>, String> {
        {
            let guard = self.guides.read().await;
            if let Some(g) = guard.get(url) {
                let ttl = if g.failed.is_some() { EPG_FAIL_TTL } else { EPG_TTL };
                if g.at.elapsed() < ttl {
                    return match &g.failed {
                        Some(err) => Err(err.clone()),
                        None => Ok(g.clone()),
                    };
                }
            }
        }

        let url_owned = url.to_string();
        match self.download_bytes(url, allow_lan).await {
            Ok(raw) => {
                let now = now_ms();
                let by_id = tokio::task::spawn_blocking(move || {
                    parse_xmltv_bytes(&raw, now, None, EPG_PER_CHANNEL)
                })
                .await
                .map_err(|e| format!("EPG task error: {e}"))?;
                let entry = Arc::new(GuideEntry {
                    at: Instant::now(),
                    failed: None,
                    by_id,
                });
                self.guides.write().await.insert(url_owned, entry.clone());
                Ok(entry)
            }
            Err(err) => {
                let entry = Arc::new(GuideEntry {
                    at: Instant::now(),
                    failed: Some(err.clone()),
                    by_id: HashMap::new(),
                });
                self.guides.write().await.insert(url_owned, entry);
                Err(err)
            }
        }
    }

    pub async fn get(
        &self,
        url: &str,
        ids: &[String],
        allow_lan: bool,
    ) -> Result<HashMap<String, Vec<EpgProgramme>>, String> {
        if url.is_empty() {
            return Err("url requerida".to_string());
        }
        let guide = self.load_guide(url, allow_lan).await?;
        let now = now_ms();
        let mut out = HashMap::new();
        for id in ids.iter().take(EPG_MAX_IDS) {
            if let Some(list) = guide.by_id.get(id) {
                let shown: Vec<EpgProgramme> = list
                    .iter()
                    .filter(|p| p.e > now)
                    .take(EPG_ANSWER_PER_CHANNEL)
                    .cloned()
                    .collect();
                if !shown.is_empty() {
                    out.insert(id.clone(), shown);
                }
            }
        }
        Ok(out)
    }

    pub async fn schedule(
        &self,
        url: &str,
        id: &str,
        allow_lan: bool,
    ) -> Result<Vec<EpgProgramme>, String> {
        if url.is_empty() || id.is_empty() {
            return Err("url e id requeridos".to_string());
        }
        let key = format!("{url}|{id}");
        let now = now_ms();
        {
            let guard = self.schedules.read().await;
            if let Some(hit) = guard.get(&key) {
                if hit.at.elapsed() < EPG_TTL {
                    return Ok(hit.list.iter().filter(|p| p.e > now).cloned().collect());
                }
            }
        }

        let guide = self.load_guide(url, allow_lan).await?;
        let have: Vec<EpgProgramme> = guide
            .by_id
            .get(id)
            .map(|l| l.iter().filter(|p| p.e > now).cloned().collect())
            .unwrap_or_default();
        let reach = have.last().map(|p| p.e).unwrap_or(0);
        if !have.is_empty()
            && (have.len() < EPG_PER_CHANNEL || reach >= now + EPG_AHEAD_MS - 3_600_000)
        {
            return Ok(have);
        }

        // Re-read stream keeping only this single channel for full 12h schedule
        let raw = match self.download_bytes(url, allow_lan).await {
            Ok(b) => b,
            Err(_) => return Ok(have),
        };
        let id_owned = id.to_string();
        let mut by_id = tokio::task::spawn_blocking(move || {
            parse_xmltv_bytes(&raw, now, Some(&id_owned), EPG_SCHEDULE_MAX)
        })
        .await
        .map_err(|e| format!("EPG schedule error: {e}"))?;
        let list = by_id.remove(id).unwrap_or(have);

        let mut sched = self.schedules.write().await;
        if sched.len() >= EPG_SCHEDULE_CACHE {
            if let Some(oldest_k) = sched
                .iter()
                .min_by_key(|(_, v)| v.at)
                .map(|(k, _)| k.clone())
            {
                sched.remove(&oldest_k);
            }
        }
        sched.insert(
            key,
            ScheduleEntry {
                at: Instant::now(),
                list: list.clone(),
            },
        );
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_xmltv_timestamps_with_offsets() {
        let t_utc = xmltv_time("20261119050428 +0000");
        let t_minus5 = xmltv_time("20261119000428 -0500");
        assert_eq!(t_utc, t_minus5);
        assert!(t_utc > 1_700_000_000_000);
    }

    #[test]
    fn streams_xmltv_programmes_in_window() {
        let now = xmltv_time("20261119050000 +0000");
        let xml = r#"<?xml version="1.0"?>
        <tv>
          <programme start="20261119043000 +0000" stop="20261119053000 +0000" channel="ch1">
            <title lang="es">Noticiero &amp; Clima</title>
            <desc>Resumen   del día</desc>
          </programme>
          <programme start="20261119010000 +0000" stop="20261119020000 +0000" channel="ch1">
            <title>Pasado</title>
          </programme>
        </tv>"#;
        let map = parse_xmltv_bytes(xml.as_bytes(), now, None, 10);
        let list = map.get("ch1").expect("channel ch1");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].t, "Noticiero & Clima");
        assert_eq!(list[0].d.as_deref(), Some("Resumen del día"));
    }
}
