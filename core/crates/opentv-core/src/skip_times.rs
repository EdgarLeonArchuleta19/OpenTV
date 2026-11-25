//! Intro / recap / credits timestamps for series and anime episodes, taken from public
//! community databases (all requests go through NetGuard via `safe_http`):
//!
//! - **AniSkip** (`api.aniskip.com/v2/skip-times/{malId}/{episode}`): anime openings/endings by
//!   MyAnimeList id. The MAL id comes from the `arm.haglund.dev` mapping service, either from a
//!   `kitsu:` id (one Kitsu entry = one MAL entry, same episode numbering) or from an IMDb id when
//!   exactly one MAL TV entry maps to the TMDB season being played (otherwise the numbering
//!   cannot be mapped confidently and AniSkip is skipped).
//! - **IntroDB** (`api.introdb.app/segments`) and **TheIntroDB** (`api.theintrodb.org/v2/media`):
//!   crowd-sourced intro/recap/credits for TV episodes by IMDb id + season/episode.
//!
//! Results are cached in memory per episode (including "nothing found").

use std::collections::{HashMap, VecDeque};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::RwLock;

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, FetchOptions};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);
const CACHE_MAX: usize = 400;
/// Longest plausible opening (some anime/drama cold opens + long intros run ~3 min).
const MAX_INTRO_SECS: f64 = 300.0;
/// Largest JSON body read from any of these services (answers are a few KB).
const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub start: f64,
    /// `None` = runs until the end of the file.
    pub end: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SkipTimes {
    pub intro: Option<Segment>,
    pub recap: Option<Segment>,
    pub credits: Option<Segment>,
}

impl SkipTimes {
    fn is_empty(&self) -> bool {
        self.intro.is_none() && self.recap.is_none() && self.credits.is_none()
    }
}

/// What the request identifies: an IMDb series or a Kitsu anime entry.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Imdb(String),
    Kitsu(u64),
}

/// `tt0903747`, `stremio:tt0903747:1:2`, `kitsu:7442`, `kitsu:7442:3` -> target.
pub fn parse_target(item_id: &str, episode_id: &str) -> Option<Target> {
    for raw in [item_id, episode_id] {
        let id = raw.trim().trim_start_matches("stremio:");
        if let Some(rest) = id.strip_prefix("kitsu:") {
            if let Ok(n) = rest.split(':').next().unwrap_or("").parse::<u64>() {
                return Some(Target::Kitsu(n));
            }
        }
        let head = id.split(':').next().unwrap_or("");
        if head.len() > 2 && head.len() <= 12 && head.starts_with("tt") && head[2..].chars().all(|c| c.is_ascii_digit()) {
            return Some(Target::Imdb(head.to_string()));
        }
    }
    None
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64().filter(|n| n.is_finite())
}

fn segment_from(start: Option<f64>, end: Option<f64>) -> Option<Segment> {
    let start = start.unwrap_or(0.0).max(0.0);
    match end {
        Some(e) if e <= start + 1.0 => None,
        _ => Some(Segment { start, end }),
    }
}

/// AniSkip v2 body -> segments (`op`/`mixed-op` = intro, `ed`/`mixed-ed` = credits).
pub fn parse_aniskip(v: &Value) -> SkipTimes {
    let mut out = SkipTimes::default();
    if v["found"].as_bool() != Some(true) {
        return out;
    }
    for r in v["results"].as_array().into_iter().flatten() {
        let seg = segment_from(num(&r["interval"]["startTime"]), num(&r["interval"]["endTime"]));
        let Some(seg) = seg else { continue };
        if seg.end.is_none() {
            continue;
        }
        match r["skipType"].as_str().unwrap_or("") {
            "op" | "mixed-op" if out.intro.is_none() => out.intro = Some(seg),
            "ed" | "mixed-ed" if out.credits.is_none() => out.credits = Some(seg),
            "recap" if out.recap.is_none() => out.recap = Some(seg),
            _ => {}
        }
    }
    out
}

/// IntroDB `/segments` body (`intro`/`recap`/`outro` objects in seconds, or null).
pub fn parse_introdb(v: &Value) -> SkipTimes {
    let seg = |key: &str| -> Option<Segment> {
        let o = &v[key];
        if !o.is_object() {
            return None;
        }
        segment_from(num(&o["start_sec"]), num(&o["end_sec"]))
    };
    SkipTimes {
        intro: seg("intro").filter(|s| s.end.is_some()),
        recap: seg("recap").filter(|s| s.end.is_some()),
        credits: seg("outro"),
    }
}

/// TheIntroDB `/v2/media` body (`intro`/`recap`/`credits` arrays in ms; null start = 0,
/// null end = end of file).
pub fn parse_theintrodb(v: &Value) -> SkipTimes {
    let seg = |key: &str| -> Option<Segment> {
        let first = v[key].as_array()?.first()?;
        segment_from(
            num(&first["start_ms"]).map(|ms| ms / 1000.0),
            num(&first["end_ms"]).map(|ms| ms / 1000.0),
        )
    };
    SkipTimes {
        intro: seg("intro").filter(|s| s.end.is_some()),
        recap: seg("recap").filter(|s| s.end.is_some()),
        credits: seg("credits"),
    }
}

/// MAL id for one TMDB season from an `arm.haglund.dev /api/v2/imdb` answer: only when exactly
/// one MAL TV entry maps to that season (split cours like "Part II" share a TMDB season and their
/// episode numbers restart, so they cannot be mapped without episode counts).
pub fn mal_for_tmdb_season(arm: &Value, season: u32) -> Option<u64> {
    let mut found: Vec<u64> = arm
        .as_array()?
        .iter()
        .filter(|e| e["media"].as_str().map(|m| m.eq_ignore_ascii_case("TV")).unwrap_or(false))
        .filter(|e| e["themoviedb-season"].as_u64() == Some(u64::from(season)))
        .filter_map(|e| e["myanimelist"].as_u64())
        .collect();
    found.sort_unstable();
    found.dedup();
    if found.len() == 1 {
        found.first().copied()
    } else {
        None
    }
}

/// Drops implausible segments (wrong release, other cut, bad submission) for a file of
/// `duration` seconds (0 = unknown).
pub fn sanitize(t: SkipTimes, duration: f64) -> SkipTimes {
    let known = duration > 60.0;
    let intro = t.intro.filter(|s| {
        let end = s.end.unwrap_or(0.0);
        end - s.start <= MAX_INTRO_SECS && (!known || end <= duration * 0.6)
    });
    let recap = t.recap.filter(|s| !known || s.end.unwrap_or(0.0) <= duration * 0.5);
    let credits = t.credits.filter(|s| {
        !known || (s.start >= duration * 0.5 && s.start < duration && s.end.map(|e| e <= duration + 90.0).unwrap_or(true))
    });
    SkipTimes { intro, recap, credits }
}

fn seg_json(s: &Option<Segment>) -> Value {
    match s {
        Some(s) => json!({ "start": s.start, "end": s.end }),
        None => Value::Null,
    }
}

/// Merges sources in priority order (first non-empty field wins) into the RPC answer.
pub fn merge(sources: &[(&str, SkipTimes)]) -> Value {
    let pick = |f: fn(&SkipTimes) -> Option<Segment>| -> (Option<Segment>, &str) {
        sources
            .iter()
            .find_map(|(name, t)| f(t).map(|s| (Some(s), *name)))
            .unwrap_or((None, ""))
    };
    let (intro, intro_src) = pick(|t| t.intro);
    let (recap, _) = pick(|t| t.recap);
    let (credits, credits_src) = pick(|t| t.credits);
    json!({
        "intro": seg_json(&intro),
        "recap": seg_json(&recap),
        "credits": seg_json(&credits),
        "introSource": intro_src,
        "creditsSource": credits_src,
    })
}

/// GET returning `Some(json)` on 200, `Some(Null)` on 404 (answered, nothing there) and
/// `None` on network/other errors.
async fn get_json(dns: &Dnsx, url: &str) -> Option<Value> {
    let mut opts = FetchOptions::new(dns, false, REQUEST_TIMEOUT);
    opts.user_agent = Some("OpenTV".to_string());
    opts.max_redirects = 2;
    let mut resp = fetch_url(url, opts).await.ok()?;
    match resp.status().as_u16() {
        200 => {
            if resp.content_length().is_some_and(|n| n > MAX_BODY_BYTES as u64) {
                return None;
            }
            let mut body = Vec::new();
            while let Some(chunk) = resp.chunk().await.ok()? {
                if body.len() + chunk.len() > MAX_BODY_BYTES {
                    return None;
                }
                body.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&body).ok()
        }
        404 => Some(Value::Null),
        _ => None,
    }
}

async fn mal_id(dns: &Dnsx, target: &Target, season: u32) -> Option<u64> {
    match target {
        Target::Kitsu(k) => {
            let v = get_json(dns, &format!("https://arm.haglund.dev/api/v2/ids?source=kitsu&id={k}")).await?;
            v["myanimelist"].as_u64()
        }
        Target::Imdb(tt) => {
            let v = get_json(dns, &format!("https://arm.haglund.dev/api/v2/imdb?id={tt}")).await?;
            mal_for_tmdb_season(&v, season)
        }
    }
}

async fn aniskip(dns: &Dnsx, target: &Target, season: u32, episode: u32, duration: f64) -> Option<SkipTimes> {
    let mal = mal_id(dns, target, season).await?;
    // `episodeLength` makes AniSkip drop submissions made for a file of another length.
    let len = if duration > 60.0 { duration.round() as u64 } else { 0 };
    let url = format!(
        "https://api.aniskip.com/v2/skip-times/{mal}/{episode}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength={len}"
    );
    get_json(dns, &url).await.map(|v| parse_aniskip(&v))
}

async fn introdb(dns: &Dnsx, tt: &str, season: u32, episode: u32) -> Option<SkipTimes> {
    let url = format!("https://api.introdb.app/segments?imdb_id={tt}&season={season}&episode={episode}");
    get_json(dns, &url).await.map(|v| parse_introdb(&v))
}

async fn theintrodb(dns: &Dnsx, tt: &str, season: u32, episode: u32) -> Option<SkipTimes> {
    let url = format!("https://api.theintrodb.org/v2/media?imdb_id={tt}&season={season}&episode={episode}");
    get_json(dns, &url).await.map(|v| parse_theintrodb(&v))
}

struct Cache {
    map: HashMap<String, Value>,
    order: VecDeque<String>,
}

fn cache() -> &'static RwLock<Cache> {
    static CACHE: OnceLock<RwLock<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| {
        RwLock::new(Cache {
            map: HashMap::new(),
            order: VecDeque::new(),
        })
    })
}

/// RPC `skipSegments`: `{ itemId, episodeId?, season, episode, durationSec?, anime? }` ->
/// `{ intro, recap, credits: {start, end|null}|null, introSource, creditsSource }` (seconds).
pub async fn lookup(dns: &Dnsx, params: &Value) -> Value {
    let item_id = params["itemId"].as_str().unwrap_or("");
    let episode_id = params["episodeId"].as_str().unwrap_or("");
    let season = params["season"].as_u64().unwrap_or(0).min(1000) as u32;
    let episode = params["episode"].as_u64().unwrap_or(0).min(100_000) as u32;
    let duration = params["durationSec"].as_f64().filter(|d| d.is_finite() && *d > 0.0).unwrap_or(0.0);
    let anime = params["anime"].as_bool().unwrap_or(false);

    let empty = merge(&[]);
    let Some(target) = parse_target(item_id, episode_id) else { return empty };
    if episode == 0 {
        return empty;
    }
    // The answer depends on the file length (AniSkip `episodeLength` and `sanitize`) and on
    // the anime flag (whether AniSkip is asked at all): both are part of the key, so another
    // release of the same episode is not served segments validated for a different cut.
    let key = cache_key(&target, season, episode, duration, anime);
    if let Some(hit) = cache().read().await.map.get(&key) {
        return hit.clone();
    }

    let use_aniskip = matches!(target, Target::Kitsu(_)) || (anime && season > 0);
    let (ani, idb, tidb) = match &target {
        Target::Imdb(tt) if season > 0 => {
            let ani_fut = async {
                if use_aniskip {
                    aniskip(dns, &target, season, episode, duration).await
                } else {
                    None
                }
            };
            tokio::join!(ani_fut, introdb(dns, tt, season, episode), theintrodb(dns, tt, season, episode))
        }
        _ if use_aniskip => (aniskip(dns, &target, season, episode, duration).await, None, None),
        _ => (None, None, None),
    };
    let answered = ani.is_some() || idb.is_some() || tidb.is_some();
    let sources: Vec<(&str, SkipTimes)> = [("AniSkip", ani), ("IntroDB", idb), ("TheIntroDB", tidb)]
        .into_iter()
        .filter_map(|(n, t)| t.map(|t| (n, sanitize(t, duration))))
        .filter(|(_, t)| !t.is_empty())
        .collect();
    let out = merge(&sources);

    // Network failures are not cached, so a later episode open can retry.
    if answered {
        let mut c = cache().write().await;
        if c.map.insert(key.clone(), out.clone()).is_none() {
            c.order.push_back(key);
        }
        while c.order.len() > CACHE_MAX {
            if let Some(old) = c.order.pop_front() {
                c.map.remove(&old);
            }
        }
    }
    out
}

fn cache_key(target: &Target, season: u32, episode: u32, duration: f64, anime: bool) -> String {
    let secs = if duration > 60.0 { duration.round() as u64 } else { 0 };
    format!("{target:?}|{season}|{episode}|{secs}|{anime}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ids() {
        assert_eq!(parse_target("stremio:tt0903747", ""), Some(Target::Imdb("tt0903747".into())));
        assert_eq!(parse_target("tt0903747:1:2", ""), Some(Target::Imdb("tt0903747".into())));
        assert_eq!(parse_target("kitsu:7442", "kitsu:7442:3"), Some(Target::Kitsu(7442)));
        assert_eq!(parse_target("local:abc", "kitsu:12:1"), Some(Target::Kitsu(12)));
        assert_eq!(parse_target("ttx", ""), None);
        assert_eq!(parse_target("tt12345678901234567890", ""), None);
    }

    #[test]
    fn parses_live_aniskip_answer() {
        // Captured from api.aniskip.com for Attack on Titan (MAL 16498) episode 3.
        let v: Value = serde_json::from_str(r#"{"found":true,"results":[{"interval":{"startTime":4,"endTime":96},"skipType":"op","skipId":"ec59","episodeLength":1452.284},{"interval":{"startTime":1345.015,"endTime":1435.015},"skipType":"ed","skipId":"23f2","episodeLength":1450.0518}],"message":"Successfully found skip times","statusCode":200}"#).unwrap();
        let t = parse_aniskip(&v);
        assert_eq!(t.intro, Some(Segment { start: 4.0, end: Some(96.0) }));
        assert_eq!(t.credits.unwrap().start, 1345.015);
        assert!(parse_aniskip(&json!({"found": false, "results": []})).is_empty());
    }

    #[test]
    fn parses_live_introdb_and_theintrodb_answers() {
        // Breaking Bad S1E2 as returned by both services.
        let idb: Value = serde_json::from_str(r#"{"imdb_id":"tt0903747","season":1,"episode":2,"intro":{"start_sec":314.5,"end_sec":331,"start_ms":314500,"end_ms":331000},"recap":null,"outro":{"start_sec":2843,"end_sec":2901},"post_credits":null,"no_intro":false}"#).unwrap();
        let t = parse_introdb(&idb);
        assert_eq!(t.intro, Some(Segment { start: 314.5, end: Some(331.0) }));
        assert_eq!(t.credits, Some(Segment { start: 2843.0, end: Some(2901.0) }));
        assert!(t.recap.is_none());

        let tidb: Value = serde_json::from_str(r#"{"tmdb_id":1396,"type":"tv","season":1,"episode":2,"intro":[{"start_ms":null,"end_ms":29654}],"recap":[{"start_ms":0,"end_ms":0}],"credits":[{"start_ms":2848346,"end_ms":null}]}"#).unwrap();
        let t = parse_theintrodb(&tidb);
        assert_eq!(t.intro, Some(Segment { start: 0.0, end: Some(29.654) }));
        assert!(t.recap.is_none(), "zero-length recap is noise");
        assert_eq!(t.credits, Some(Segment { start: 2848.346, end: None }));
    }

    #[test]
    fn maps_mal_only_for_an_unambiguous_tmdb_season() {
        let arm = json!([
            {"media":"TV","myanimelist":16498,"themoviedb-season":1},
            {"media":"OVA","myanimelist":18397,"themoviedb-season":0},
            {"media":"TV","myanimelist":25777,"themoviedb-season":2},
            {"media":"TV","myanimelist":35760,"themoviedb-season":3},
            {"media":"TV","myanimelist":38524,"themoviedb-season":3}
        ]);
        assert_eq!(mal_for_tmdb_season(&arm, 1), Some(16498));
        assert_eq!(mal_for_tmdb_season(&arm, 2), Some(25777));
        assert_eq!(mal_for_tmdb_season(&arm, 3), None, "split cour is ambiguous");
        assert_eq!(mal_for_tmdb_season(&arm, 5), None);
    }

    #[test]
    fn drops_segments_that_do_not_fit_the_file() {
        let t = SkipTimes {
            intro: Some(Segment { start: 900.0, end: Some(990.0) }),
            recap: None,
            credits: Some(Segment { start: 100.0, end: None }),
        };
        assert!(sanitize(t.clone(), 1400.0).is_empty());
        // Unknown duration keeps them (the apps re-check against the real length).
        assert!(!sanitize(t, 0.0).is_empty());
    }

    #[test]
    fn cache_key_depends_on_file_length_and_anime_flag() {
        let t = Target::Imdb("tt0903747".into());
        let a = cache_key(&t, 1, 2, 2905.2, false);
        assert_eq!(a, cache_key(&t, 1, 2, 2904.8, false));
        assert_ne!(a, cache_key(&t, 1, 2, 2700.0, false));
        assert_ne!(a, cache_key(&t, 1, 2, 2905.0, true));
        assert_eq!(cache_key(&t, 1, 2, 0.0, false), cache_key(&t, 1, 2, 30.0, false));
    }

    #[test]
    fn merge_prefers_earlier_sources_per_field() {
        let a = SkipTimes { intro: Some(Segment { start: 4.0, end: Some(96.0) }), ..Default::default() };
        let b = SkipTimes {
            intro: Some(Segment { start: 0.0, end: Some(92.0) }),
            credits: Some(Segment { start: 1344.0, end: Some(1435.0) }),
            ..Default::default()
        };
        let v = merge(&[("AniSkip", a), ("IntroDB", b)]);
        assert_eq!(v["intro"]["end"], json!(96.0));
        assert_eq!(v["introSource"], "AniSkip");
        assert_eq!(v["credits"]["start"], json!(1344.0));
        assert_eq!(v["creditsSource"], "IntroDB");
        assert!(merge(&[])["intro"].is_null());
    }

    /// Live check against the real services: `cargo test -p opentv-core skip_times -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_lookup() {
        let dns = Dnsx::new();
        let bb = lookup(&dns, &json!({"itemId":"tt0903747","season":1,"episode":2,"durationSec":2905.0})).await;
        println!("Breaking Bad S1E2: {bb}");
        assert!(bb["intro"].is_object());
        let aot = lookup(&dns, &json!({"itemId":"kitsu:7442","episodeId":"kitsu:7442:3","season":1,"episode":3,"durationSec":1452.0,"anime":true})).await;
        println!("AoT kitsu E3: {aot}");
        assert_eq!(aot["introSource"], "AniSkip");
        let aot_tt = lookup(&dns, &json!({"itemId":"tt2560140","season":2,"episode":1,"durationSec":1440.0,"anime":true})).await;
        println!("AoT tt S2E1: {aot_tt}");
    }
}
