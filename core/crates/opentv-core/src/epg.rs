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
    supplements: Arc<RwLock<HashMap<String, Arc<SupplementGuide>>>>,
    supplement_answers: Arc<RwLock<HashMap<String, SupplementAnswer>>>,
    supplement_load: Arc<tokio::sync::Mutex<()>>,
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
    parse_xmltv_reader(xmltv_reader(raw), now, only_channel, cap, EPG_AHEAD_MS)
}

/// Reads only the `<channel id><display-name>` pairs of an XMLTV stream (first name per id).
pub fn parse_xmltv_channels(raw: &[u8]) -> Vec<(String, String)> {
    let mut xml = Reader::from_reader(xmltv_reader(raw));
    xml.config_mut().trim_text(false);
    xml.config_mut().check_end_names = false;
    let mut out: Vec<(String, String)> = Vec::new();
    let mut buf = Vec::with_capacity(4096);
    let mut cur_id: Option<String> = None;
    let mut name = String::new();
    let mut in_name = false;
    loop {
        buf.clear();
        match xml.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => match e.name().as_ref() {
                b"channel" => {
                    cur_id = e
                        .attributes()
                        .flatten()
                        .find(|a| a.key.as_ref() == b"id")
                        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()));
                    name.clear();
                }
                b"display-name" if cur_id.is_some() && name.is_empty() => in_name = true,
                _ => {}
            },
            // Display names are short; a runaway text node must not grow without bound.
            Ok(Event::Text(ref e)) if in_name && name.len() < CHANNEL_NAME_MAX => {
                if let Ok(t) = e.unescape() {
                    name.push_str(&t);
                }
            }
            Ok(Event::CData(ref e)) if in_name && name.len() < CHANNEL_NAME_MAX => {
                name.push_str(&String::from_utf8_lossy(e.as_ref()));
            }
            Ok(Event::End(ref e)) => match e.name().as_ref() {
                b"display-name" => in_name = false,
                b"channel" => {
                    in_name = false;
                    if let Some(id) = cur_id.take() {
                        let n = clip(&name, CHANNEL_NAME_MAX);
                        if !id.is_empty() && !n.is_empty() && out.len() < EPG_MAX_IDS * 4 {
                            out.push((id, n));
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

fn xmltv_reader(raw: &[u8]) -> BufReader<Box<dyn Read + '_>> {
    let is_gzip = raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b;
    let reader: Box<dyn Read> = if is_gzip {
        Box::new(GzDecoder::new(raw))
    } else {
        Box::new(raw)
    };
    BufReader::new(reader)
}

fn parse_xmltv_reader<R: std::io::BufRead>(
    input: R,
    now: i64,
    only_channel: Option<&str>,
    cap: usize,
    ahead_ms: i64,
) -> HashMap<String, Vec<EpgProgramme>> {
    let mut xml = Reader::from_reader(input);
    xml.config_mut().trim_text(false);
    xml.config_mut().check_end_names = false;

    let until = now + ahead_ms;
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

// ---------------------------------------------------------------------------
// Supplementary guide (epgshare01): used when a channel's own EPG is missing or
// placeholder-only (e.g. Pluto TV "Azteca UNO -1 hora" whose guide repeats its name).
// ---------------------------------------------------------------------------

const SUPPLEMENT_BASE: &str = "https://epgshare01.online/epgshare01/epg_ripper_";
const SUPPLEMENT_MAX_GUIDES: usize = 3;
const SUPPLEMENT_ANSWER_CACHE: usize = 64;
const SUPPLEMENT_ANSWER_TTL: Duration = Duration::from_secs(60 * 60);
const SUPPLEMENT_MAX_TRIES: usize = 4;
const SUPPLEMENT_MAX_OFFSET_H: i64 = 12;
const HOUR_MS: i64 = 3_600_000;
/// Longest channel name considered when matching (guide entries and `epgSupplement` input).
const CHANNEL_NAME_MAX: usize = 160;

/// Guide file on epgshare01 for an ISO country code (only files known to exist).
pub fn supplement_file(country: &str) -> Option<&'static str> {
    let c = fold_text(country.trim());
    Some(match c.as_str() {
        "" | "mx" | "mex" | "mexico" => "MX1",
        "ar" | "argentina" => "AR1",
        "es" | "espana" => "ES1",
        "co" | "colombia" => "CO1",
        "cl" | "chile" => "CL1",
        "pe" | "peru" => "PE1",
        "ec" | "ecuador" => "EC1",
        "uy" | "uruguay" => "UY1",
        "do" => "DO1",
        "cr" => "CR1",
        "pa" => "PA1",
        "sv" => "SV1",
        "br" | "brasil" | "brazil" => "BR1",
        _ => return None,
    })
}

/// Lowercases and strips Latin accents ("Telefórmula" -> "teleformula").
pub fn fold_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars().flat_map(|c| c.to_lowercase()) {
        out.push(match ch {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        });
    }
    out
}

const NAME_STOPWORDS: &[&str] = &[
    "canal", "channel", "tv", "television", "hd", "fhd", "uhd", "sd", "4k", "mx", "de", "del", "la",
    "las", "el", "los", "the", "senal", "en", "vivo", "feed", "east", "este",
];
const NAME_REGIONS: &[&str] = &[
    "mexico", "latinoamerica", "latam", "latino", "latina", "internacional", "international",
    "espana", "argentina", "colombia", "chile", "peru", "usa", "us",
];
const HOUR_WORDS: &[&str] = &["h", "hr", "hrs", "hora", "horas", "hour", "hours"];
const WEST_WORDS: &[&str] = &["west", "oeste", "pacific", "pacifico"];

/// Normalized channel name: sorted significant tokens plus the feed delay it implies.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChannelNameKey {
    /// Sorted tokens joined by a space ("azteca uno").
    pub key: String,
    /// Keys taken from parenthesised aliases ("Canal 2 (Las Estrellas)" -> "estrellas").
    pub alt: Vec<String>,
    /// Hours this feed airs after the main feed ("-1 hora" -> 1, "+1" -> 1, "West" -> 3).
    pub offset_h: i64,
}

fn tokenize(folded: &str) -> Vec<String> {
    let mut raw: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in folded.chars() {
        if ch.is_alphanumeric() {
            cur.push(ch);
        } else {
            if !cur.is_empty() {
                raw.push(std::mem::take(&mut cur));
            }
            if ch == '+' || ch == '-' {
                raw.push(ch.to_string());
            }
        }
    }
    if !cur.is_empty() {
        raw.push(cur);
    }
    raw
}

/// Returns (significant tokens, feed offset in hours).
fn name_tokens(text: &str) -> (Vec<String>, i64) {
    let raw = tokenize(&fold_text(text));
    let mut tokens: Vec<String> = Vec::new();
    let mut offset = 0i64;
    let mut i = 0;
    while i < raw.len() {
        let t = raw[i].as_str();
        if t == "+" || t == "-" {
            if let Some(n) = raw.get(i + 1).and_then(|n| n.parse::<i64>().ok()) {
                if (1..=SUPPLEMENT_MAX_OFFSET_H).contains(&n) && raw[i + 1].len() <= 2 {
                    offset = n;
                    i += 2;
                    if raw.get(i).map(|w| HOUR_WORDS.contains(&w.as_str())).unwrap_or(false) {
                        i += 1;
                    }
                    continue;
                }
            }
            i += 1;
            continue;
        }
        if WEST_WORDS.contains(&t) {
            if offset == 0 {
                offset = 3;
            }
        } else if !NAME_STOPWORDS.contains(&t) {
            tokens.push(t.to_string());
        }
        i += 1;
    }
    // Region words only qualify a name ("Canal Sony México"); drop them unless nothing else is left.
    if tokens.iter().any(|t| !NAME_REGIONS.contains(&t.as_str())) {
        tokens.retain(|t| !NAME_REGIONS.contains(&t.as_str()));
    }
    (tokens, offset)
}

fn join_sorted(mut tokens: Vec<String>) -> String {
    tokens.sort();
    tokens.dedup();
    tokens.join(" ")
}

/// Builds the matching key of a channel display name.
pub fn channel_name_key(name: &str) -> ChannelNameKey {
    let mut main = String::with_capacity(name.len());
    let mut parens: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let mut cur = String::new();
    for ch in name.chars() {
        match ch {
            '(' | '[' => {
                depth += 1;
                if depth == 1 {
                    cur.clear();
                }
                main.push(' ');
            }
            ')' | ']' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    parens.push(std::mem::take(&mut cur));
                }
            }
            _ if depth > 0 => cur.push(ch),
            _ => main.push(ch),
        }
    }
    let (tokens, mut offset_h) = name_tokens(&main);
    let mut alt: Vec<String> = Vec::new();
    for p in parens {
        let (pt, p_off) = name_tokens(&p);
        if offset_h == 0 && p_off > 0 {
            offset_h = p_off;
        }
        if pt.is_empty() || pt.iter().all(|t| NAME_REGIONS.contains(&t.as_str())) {
            continue;
        }
        let k = join_sorted(pt);
        if !alt.contains(&k) {
            alt.push(k);
        }
    }
    let mut key = join_sorted(tokens);
    if key.is_empty() && !alt.is_empty() {
        key = alt.remove(0);
    }
    ChannelNameKey { key, alt, offset_h }
}

#[derive(Clone, Debug)]
struct SupplementChannel {
    id: String,
    name: ChannelNameKey,
}

impl SupplementChannel {
    fn keys(&self) -> impl Iterator<Item = &String> {
        std::iter::once(&self.name.key).chain(self.name.alt.iter())
    }
}

/// "One name is the other plus a single extra word, and the shorter one has 2+ words with a
/// non-numeric one" (e.g. "golden premier" vs "golden premier 2" is NOT strong: numbers differ).
fn strong_overlap(a: &str, b: &str) -> bool {
    let ta: Vec<&str> = a.split(' ').filter(|s| !s.is_empty()).collect();
    let tb: Vec<&str> = b.split(' ').filter(|s| !s.is_empty()).collect();
    let (small, big) = if ta.len() <= tb.len() { (ta, tb) } else { (tb, ta) };
    if small.len() < 2 || big.len() != small.len() + 1 {
        return false;
    }
    if !small.iter().all(|t| big.contains(t)) {
        return false;
    }
    if !small.iter().any(|t| t.chars().any(|c| c.is_alphabetic())) {
        return false;
    }
    // The extra word must not be a number: "fox sports" vs "fox sports 2" are different channels.
    let extra = big.iter().find(|t| !small.contains(t)).copied().unwrap_or("");
    !extra.chars().all(|c| c.is_ascii_digit())
}

/// Ordered candidates `(channel index, shift hours)` for a requested name; empty when no
/// confident match exists. A dedicated delayed feed in the guide wins over shifting the main one.
fn supplement_candidates(channels: &[SupplementChannel], want: &ChannelNameKey) -> Vec<(usize, i64)> {
    if want.key.is_empty() {
        return Vec::new();
    }
    let with_offsets = |idxs: Vec<usize>| -> Vec<(usize, i64)> {
        let mut c: Vec<(usize, i64)> = idxs
            .into_iter()
            .filter(|&i| channels[i].name.offset_h <= want.offset_h)
            .map(|i| (i, want.offset_h - channels[i].name.offset_h))
            .collect();
        c.sort_by_key(|&(i, shift)| (shift, i));
        c.truncate(SUPPLEMENT_MAX_TRIES);
        c
    };

    let exact: Vec<usize> = channels
        .iter()
        .enumerate()
        .filter(|(_, ch)| ch.keys().any(|k| *k == want.key))
        .map(|(i, _)| i)
        .collect();
    if !exact.is_empty() {
        return with_offsets(exact);
    }

    let mut strong_key: Option<&str> = None;
    let mut strong: Vec<usize> = Vec::new();
    for (i, ch) in channels.iter().enumerate() {
        for k in ch.keys() {
            if strong_overlap(&want.key, k) {
                match strong_key {
                    None => strong_key = Some(k.as_str()),
                    Some(prev) if prev == k.as_str() => {}
                    // Two different names fit: ambiguous, never guess.
                    Some(_) => return Vec::new(),
                }
                strong.push(i);
                break;
            }
        }
    }
    with_offsets(strong)
}

/// Shifts programmes `shift_h` hours later and keeps those not yet finished.
fn shift_programmes(list: Vec<EpgProgramme>, shift_h: i64, now: i64) -> Vec<EpgProgramme> {
    let d = shift_h * HOUR_MS;
    list.into_iter()
        .map(|mut p| {
            p.s += d;
            p.e += d;
            p
        })
        .filter(|p| p.e > now)
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpgSupplement {
    pub id: String,
    pub offset_hours: i64,
    pub programmes: Vec<EpgProgramme>,
}

struct SupplementGuide {
    at: Instant,
    failed: Option<String>,
    raw: Arc<Vec<u8>>,
    channels: Arc<Vec<SupplementChannel>>,
}

struct SupplementAnswer {
    at: Instant,
    value: Option<EpgSupplement>,
}

impl EpgStore {
    pub fn new(dns: Dnsx) -> Self {
        Self {
            dns,
            guides: Arc::new(RwLock::new(HashMap::new())),
            schedules: Arc::new(RwLock::new(HashMap::new())),
            supplements: Arc::new(RwLock::new(HashMap::new())),
            supplement_answers: Arc::new(RwLock::new(HashMap::new())),
            supplement_load: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    async fn load_supplement_guide(&self, file: &str) -> Result<Arc<SupplementGuide>, String> {
        let fresh = |g: &SupplementGuide| {
            let ttl = if g.failed.is_some() { EPG_FAIL_TTL } else { EPG_TTL };
            g.at.elapsed() < ttl
        };
        if let Some(g) = self.supplements.read().await.get(file) {
            if fresh(g) {
                return Ok(g.clone());
            }
        }
        // One download at a time: the UI may ask for several placeholder channels at once.
        let _lock = self.supplement_load.lock().await;
        if let Some(g) = self.supplements.read().await.get(file) {
            if fresh(g) {
                return Ok(g.clone());
            }
        }
        let url = format!("{SUPPLEMENT_BASE}{file}.xml.gz");
        let entry = match self.download_bytes(&url, false).await {
            Ok(raw) => {
                let raw = Arc::new(raw);
                let raw_c = raw.clone();
                let channels = tokio::task::spawn_blocking(move || {
                    parse_xmltv_channels(&raw_c)
                        .into_iter()
                        .map(|(id, name)| SupplementChannel { name: channel_name_key(&name), id })
                        .collect::<Vec<_>>()
                })
                .await
                .map_err(|e| format!("EPG task error: {e}"))?;
                SupplementGuide {
                    at: Instant::now(),
                    failed: None,
                    raw,
                    channels: Arc::new(channels),
                }
            }
            Err(err) => SupplementGuide {
                at: Instant::now(),
                failed: Some(err),
                raw: Arc::new(Vec::new()),
                channels: Arc::new(Vec::new()),
            },
        };
        let entry = Arc::new(entry);
        let mut map = self.supplements.write().await;
        if map.len() >= SUPPLEMENT_MAX_GUIDES && !map.contains_key(file) {
            if let Some(oldest) = map.iter().min_by_key(|(_, v)| v.at).map(|(k, _)| k.clone()) {
                map.remove(&oldest);
            }
        }
        map.insert(file.to_string(), entry.clone());
        Ok(entry)
    }

    /// Programmes for `name` from the public epgshare01 guide of `country`, or `None`.
    pub async fn supplement(&self, name: &str, country: &str) -> Result<Option<EpgSupplement>, String> {
        let name: String = name.chars().take(CHANNEL_NAME_MAX).collect();
        let want = channel_name_key(&name);
        let file = match supplement_file(country) {
            Some(f) => f,
            None => return Ok(None),
        };
        if want.key.is_empty() {
            return Ok(None);
        }
        let cache_key = format!("{file}|{}|{}", want.key, want.offset_h);
        let now = now_ms();
        if let Some(hit) = self.supplement_answers.read().await.get(&cache_key) {
            if hit.at.elapsed() < SUPPLEMENT_ANSWER_TTL {
                return Ok(hit.value.clone().map(|mut v| {
                    v.programmes.retain(|p| p.e > now);
                    v
                }));
            }
        }

        let guide = self.load_supplement_guide(file).await?;
        if let Some(err) = &guide.failed {
            return Err(err.clone());
        }
        let candidates = supplement_candidates(&guide.channels, &want);
        let mut value: Option<EpgSupplement> = None;
        for (idx, shift) in candidates {
            let id = guide.channels[idx].id.clone();
            let raw = guide.raw.clone();
            let id_c = id.clone();
            // Parse the original-time window that lands on [now, now + 12h] after the shift.
            let parse_now = now - shift * HOUR_MS;
            let list = tokio::task::spawn_blocking(move || {
                parse_xmltv_reader(xmltv_reader(&raw), parse_now, Some(&id_c), EPG_SCHEDULE_MAX, EPG_AHEAD_MS)
                    .remove(&id_c)
                    .unwrap_or_default()
            })
            .await
            .map_err(|e| format!("EPG supplement error: {e}"))?;
            let programmes = shift_programmes(list, shift, now);
            if !programmes.is_empty() {
                value = Some(EpgSupplement { id, offset_hours: shift, programmes });
                break;
            }
        }

        let mut answers = self.supplement_answers.write().await;
        if answers.len() >= SUPPLEMENT_ANSWER_CACHE {
            if let Some(oldest) = answers.iter().min_by_key(|(_, v)| v.at).map(|(k, _)| k.clone()) {
                answers.remove(&oldest);
            }
        }
        answers.insert(cache_key, SupplementAnswer { at: Instant::now(), value: value.clone() });
        Ok(value)
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

    const SUPPLEMENT_FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
    <tv>
      <channel id="Canal.Azteca.Uno.mx"><display-name lang="es">Canal Azteca Uno</display-name></channel>
      <channel id="Canal.Azteca.Uno.-1.Hora.mx"><display-name lang="es">Canal Azteca Uno -1 Hora</display-name></channel>
      <channel id="Canal.Azteca.Uno.-2.Horas.mx"><display-name lang="es">Canal Azteca Uno -2 Horas</display-name></channel>
      <channel id="Azteca.7.mx"><display-name>Azteca 7 (XHLAT) Nuevo Laredo MX</display-name></channel>
      <channel id="Azteca.mx"><display-name>Azteca (XHOR)</display-name></channel>
      <channel id="Canal.TV.Azteca.Corazon.mx"><display-name>Canal TV Azteca Corazón</display-name></channel>
      <channel id="Canal.Telefórmula.mx"><display-name>Canal Telefórmula</display-name></channel>
      <channel id="Canal.Fox.Sports.mx"><display-name>Canal Fox Sports (México)</display-name></channel>
      <channel id="Canal.Fox.Sports.2.mx"><display-name>Canal Fox Sports 2 (México)</display-name></channel>
      <programme start="20261124180000 -0600" stop="20261124183000 -0600" channel="Canal.Azteca.Uno.mx"><title>Venga la alegría</title></programme>
      <programme start="20261124183000 -0600" stop="20261124203000 -0600" channel="Canal.Azteca.Uno.mx"><title>Exatlón México</title><desc>Competencia</desc></programme>
      <programme start="20261124203000 -0600" stop="20261124220000 -0600" channel="Canal.Azteca.Uno.mx"><title>La granja VIP</title></programme>
      <programme start="20261124180000 -0600" stop="20261124200000 -0600" channel="Canal.Azteca.Uno.-2.Horas.mx"><title>Dedicado -2</title></programme>
    </tv>"#;

    fn fixture_channels() -> Vec<SupplementChannel> {
        parse_xmltv_channels(SUPPLEMENT_FIXTURE.as_bytes())
            .into_iter()
            .map(|(id, name)| SupplementChannel { name: channel_name_key(&name), id })
            .collect()
    }

    fn pick(name: &str) -> Vec<(String, i64)> {
        let chans = fixture_channels();
        supplement_candidates(&chans, &channel_name_key(name))
            .into_iter()
            .map(|(i, s)| (chans[i].id.clone(), s))
            .collect()
    }

    #[test]
    fn normalizes_channel_names_and_feed_offsets() {
        let k = channel_name_key("Azteca UNO -1 hora");
        assert_eq!(k.key, "azteca uno");
        assert_eq!(k.offset_h, 1);
        assert_eq!(channel_name_key("Canal Azteca Uno -2 Horas").offset_h, 2);
        assert_eq!(channel_name_key("Azteca Uno +1").offset_h, 1);
        assert_eq!(channel_name_key("Azteca Uno West").offset_h, 3);
        assert_eq!(channel_name_key("Canal Azteca Uno HD").key, "azteca uno");
        assert_eq!(channel_name_key("Telefórmula").key, "teleformula");
        assert_eq!(channel_name_key("Canal Sony (México)").key, "sony");
        let alias = channel_name_key("Canal 2 de México (Canal Las Estrellas - XEW)");
        assert_eq!(alias.key, "2");
        assert_eq!(alias.alt, vec!["estrellas xew".to_string()]);
        assert_eq!(channel_name_key("Canal de las Estrellas -2 Horas - México (XEW)").offset_h, 2);
    }

    #[test]
    fn matches_exact_names_and_prefers_dedicated_feeds() {
        // Main feed: no shift.
        assert_eq!(pick("Azteca Uno")[0], ("Canal.Azteca.Uno.mx".to_string(), 0));
        // "-1 hora": dedicated -1 feed first, main feed shifted +1 h as fallback.
        assert_eq!(
            pick("Azteca UNO -1 hora"),
            vec![
                ("Canal.Azteca.Uno.-1.Hora.mx".to_string(), 0),
                ("Canal.Azteca.Uno.mx".to_string(), 1)
            ]
        );
        // "-2 horas": the dedicated -2 channel is preferred over shifting.
        assert_eq!(pick("Azteca Uno -2 horas")[0], ("Canal.Azteca.Uno.-2.Horas.mx".to_string(), 0));
        assert_eq!(pick("TELEFORMULA")[0].0, "Canal.Telefórmula.mx");
        assert_eq!(pick("Azteca Corazón")[0].0, "Canal.TV.Azteca.Corazon.mx");
        assert_eq!(pick("Fox Sports 2")[0].0, "Canal.Fox.Sports.2.mx");
    }

    #[test]
    fn never_guesses_between_similar_channels() {
        assert!(pick("Azteca 7").is_empty());
        assert!(pick("Azteca Uno Noticias Extra").is_empty());
        assert!(pick("Pluto TV Cine").is_empty());
        assert!(pick("Fox Sports 3").is_empty());
        assert!(pick("").is_empty());
        // One unique strong match (one extra word) is accepted.
        assert_eq!(pick("Fox Sports Premium")[0].0, "Canal.Fox.Sports.mx");
        assert!(supplement_file("zz").is_none());
        assert_eq!(supplement_file("MX"), Some("MX1"));
        assert_eq!(supplement_file("México"), Some("MX1"));
    }

    #[test]
    fn shifts_programmes_for_delayed_feeds() {
        let now = xmltv_time("20261124190000 -0600");
        let parse_now = now - HOUR_MS;
        let list = parse_xmltv_reader(
            xmltv_reader(SUPPLEMENT_FIXTURE.as_bytes()),
            parse_now,
            Some("Canal.Azteca.Uno.mx"),
            EPG_SCHEDULE_MAX,
            EPG_AHEAD_MS,
        )
        .remove("Canal.Azteca.Uno.mx")
        .unwrap();
        let shifted = shift_programmes(list, 1, now);
        // 18:00–18:30 shifted +1 h airs 19:00–19:30, so it is the current programme at 19:00.
        assert_eq!(shifted[0].t, "Venga la alegría");
        assert_eq!(shifted[0].s, xmltv_time("20261124190000 -0600"));
        assert_eq!(shifted[1].t, "Exatlón México");
        assert_eq!(shifted[1].s, xmltv_time("20261124193000 -0600"));
        assert_eq!(shifted[1].d.as_deref(), Some("Competencia"));
        assert_eq!(shifted[2].s, xmltv_time("20261124213000 -0600"));
    }
}
