use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::RwLock;

const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const ES_CACHE_MAX: usize = 500;
const SEARCH_CACHE_MAX: usize = 200;
const IDS_CACHE_MAX: usize = 3000;
/// Seasonal anime ranks move every few days: refresh more often than the TMDB lists.
const ANIME_CACHE_TTL: Duration = Duration::from_secs(3 * 60 * 60);
/// Items per Kids/Anime row (each Kids item costs one `external_ids` lookup, cached).
const ROW_MAX_ITEMS: usize = 24;
/// Below this many Mexican-rated results the US G/PG fallback query is appended.
const KIDS_MIN_ITEMS: usize = 16;
pub const ANIME_SEASON_LIST: &str = "anime-season";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TmdbCreds {
    #[serde(default)]
    read_access_token: String,
    #[serde(default)]
    api_key: String,
}

struct CachedValue {
    at: Instant,
    val: Value,
}

#[derive(Clone)]
pub struct TmdbClient {
    http: reqwest::Client,
    creds: Option<TmdbCreds>,
    list_cache: Arc<RwLock<HashMap<String, CachedValue>>>,
    es_cache: Arc<RwLock<HashMap<String, CachedValue>>>,
    search_cache: Arc<RwLock<HashMap<String, CachedValue>>>,
    /// "movie:123" -> IMDb id ("" = TMDB has none). Ids never change, so no TTL.
    ids_cache: Arc<RwLock<HashMap<String, String>>>,
}

impl TmdbClient {
    pub fn new(
        http: reqwest::Client,
        config_path: Option<PathBuf>,
        inline_json: Option<&str>,
    ) -> Self {
        let creds = load_credentials(config_path, inline_json);
        Self {
            http,
            creds,
            list_cache: Arc::new(RwLock::new(HashMap::new())),
            es_cache: Arc::new(RwLock::new(HashMap::new())),
            search_cache: Arc::new(RwLock::new(HashMap::new())),
            ids_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn available(&self) -> bool {
        self.creds.is_some()
    }

    /// Exact port of `tmdb.list(name)` from `service/tmdb.js` and `Tmdb.java`.
    pub async fn list(&self, name: &str) -> Value {
        if let Some(raw) = name.strip_prefix("raw:") {
            return self.raw_route(raw).await;
        }
        if let Some(q) = name.strip_prefix("search:") {
            return self.search(q).await;
        }
        if let Some(imdb) = name.strip_prefix("es:") {
            return self.spanish_title(imdb).await;
        }
        if let Some(rest) = name.strip_prefix("es-season:") {
            let mut parts = rest.split(':');
            if let (Some(tid), Some(season)) = (parts.next(), parts.next()) {
                return self.spanish_season(tid, season).await;
            }
            return json!({ "error": "Id no válido" });
        }
        // Anime comes from Kitsu (public API, no TMDB key needed) so ids stay `kitsu:` and
        // the Anime Kitsu plugin keeps serving meta/episodes for them.
        if name == ANIME_SEASON_LIST {
            return self.anime_season().await;
        }
        if let Some(spec) = kids_list_spec(name) {
            return self.kids_list(name, &spec).await;
        }

        let route = match name {
            "movie-week" => "/trending/movie/week",
            "tv-week" => "/trending/tv/week",
            "movie-top" => "/movie/top_rated",
            "tv-top" => "/tv/top_rated",
            "kids-movie" => "/discover/movie?with_genres=10751&sort_by=popularity.desc&include_adult=false",
            "kids-tv" => "/discover/tv?with_genres=10762&sort_by=popularity.desc",
            "anime-tv" => "/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc",
            _ => return json!({ "error": "Lista no permitida" }),
        };

        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };

        {
            let guard = self.list_cache.read().await;
            if let Some(hit) = guard.get(name) {
                if hit.at.elapsed() < CACHE_TTL {
                    return json!({ "items": hit.val, "cached": true });
                }
            }
        }

        let kind = if route.contains("/tv") { "tv" } else { "movie" };
        let mut all = Vec::new();
        for page in 1..=2 {
            match self.fetch_page(route, page, creds).await {
                Ok(mut res) => {
                    let empty = res.is_empty();
                    all.append(&mut res);
                    if empty {
                        break;
                    }
                }
                Err(e) if all.is_empty() => return json!({ "error": e }),
                Err(_) => break,
            }
        }

        let items: Vec<Value> = all
            .iter()
            .map(|r| slim(r, kind))
            .filter(|v| {
                !v["title"].as_str().unwrap_or("").is_empty()
                    && !v["date"].as_str().unwrap_or("").is_empty()
            })
            .collect();
        let items_val = Value::Array(items);
        self.list_cache.write().await.insert(
            name.to_string(),
            CachedValue {
                at: Instant::now(),
                val: items_val.clone(),
            },
        );
        json!({ "items": items_val })
    }

    async fn fetch_json(&self, route: &str, extra: &str, creds: &TmdbCreds) -> Result<Value, String> {
        let has_lang = route.contains("?language=") || route.contains("&language=");
        let lang = if has_lang { "" } else { "language=es-MX" };
        let auth_q = if creds.read_access_token.is_empty() {
            format!("&api_key={}", creds.api_key)
        } else {
            String::new()
        };
        let query = format!("{lang}{extra}{auth_q}");
        let query = query.trim_start_matches('&');
        let sep = if route.contains('?') { '&' } else { '?' };
        let url = format!("https://api.themoviedb.org/3{route}{sep}{query}");

        let mut req = self
            .http
            .get(&url)
            .timeout(Duration::from_secs(10))
            .header("Accept", "application/json");
        if !creds.read_access_token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", creds.read_access_token));
        }

        let resp = req.send().await.map_err(|_| "Sin conexión con TMDB".to_string())?;
        if !resp.status().is_success() {
            return Err(format!("TMDB respondió {}", resp.status().as_u16()));
        }
        resp.json::<Value>()
            .await
            .map_err(|_| "Respuesta de TMDB no válida".to_string())
    }

    async fn fetch_page(&self, route: &str, page: u32, creds: &TmdbCreds) -> Result<Vec<Value>, String> {
        let extra = if route.starts_with("/search/") {
            format!("&page={page}")
        } else {
            format!("&region=MX&page={page}")
        };
        let json = self.fetch_json(route, &extra, creds).await?;
        Ok(json["results"].as_array().cloned().unwrap_or_default())
    }

    async fn search(&self, text: &str) -> Value {
        let q: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let q: String = q.chars().take(100).collect();
        if q.chars().count() < 2 {
            return json!({ "items": [] });
        }
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let key = q.to_lowercase();
        {
            let guard = self.search_cache.read().await;
            if let Some(hit) = guard.get(&key) {
                if hit.at.elapsed() < CACHE_TTL {
                    return json!({ "items": hit.val, "cached": true });
                }
            }
        }

        let encoded: String = url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
        let route = format!("/search/multi?include_adult=false&query={encoded}");
        let results = match self.fetch_page(&route, 1, creds).await {
            Ok(r) => r,
            Err(e) => return json!({ "error": e }),
        };

        let items: Vec<Value> = results
            .iter()
            .filter_map(|r| {
                let mt = r["media_type"].as_str()?;
                if mt != "movie" && mt != "tv" {
                    return None;
                }
                let s = slim(r, mt);
                if s["title"].as_str().unwrap_or("").is_empty() {
                    None
                } else {
                    Some(s)
                }
            })
            .collect();
        let items_val = Value::Array(items);

        let mut cache = self.search_cache.write().await;
        if cache.len() >= SEARCH_CACHE_MAX {
            cache.clear();
        }
        cache.insert(
            key,
            CachedValue {
                at: Instant::now(),
                val: items_val.clone(),
            },
        );
        json!({ "items": items_val })
    }

    async fn spanish_title(&self, imdb: &str) -> Value {
        if !imdb.starts_with("tt") || imdb.len() < 7 || !imdb[2..].chars().all(|c| c.is_ascii_digit()) {
            return json!({ "error": "Id no válido" });
        }
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let key = format!("t:{imdb}");
        {
            let guard = self.es_cache.read().await;
            if let Some(hit) = guard.get(&key) {
                if hit.at.elapsed() < CACHE_TTL * 4 {
                    return hit.val.clone();
                }
            }
        }
        let route = format!("/find/{imdb}?external_source=imdb_id");
        let data = match self.fetch_json(&route, "", creds).await {
            Ok(v) => v,
            Err(e) => return json!({ "error": e }),
        };
        let movie_hit = data["movie_results"].as_array().and_then(|a| a.first());
        let tv_hit = data["tv_results"].as_array().and_then(|a| a.first());
        let out = if let Some(r) = movie_hit.or(tv_hit) {
            let kind = if movie_hit.is_some() { "movie" } else { "tv" };
            json!({
                "item": {
                    "tmdbId": r["id"],
                    "kind": kind,
                    "title": r["title"].as_str().or_else(|| r["name"].as_str()).unwrap_or(""),
                    "overview": r["overview"].as_str().unwrap_or("")
                }
            })
        } else {
            json!({ "item": null })
        };
        let mut cache = self.es_cache.write().await;
        if cache.len() >= ES_CACHE_MAX {
            cache.clear();
        }
        cache.insert(
            key,
            CachedValue {
                at: Instant::now(),
                val: out.clone(),
            },
        );
        out
    }

    async fn spanish_season(&self, tmdb_id: &str, season: &str) -> Value {
        if !tmdb_id.chars().all(|c| c.is_ascii_digit()) || !season.chars().all(|c| c.is_ascii_digit()) {
            return json!({ "error": "Id no válido" });
        }
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let key = format!("s:{tmdb_id}:{season}");
        {
            let guard = self.es_cache.read().await;
            if let Some(hit) = guard.get(&key) {
                if hit.at.elapsed() < CACHE_TTL * 4 {
                    return hit.val.clone();
                }
            }
        }
        let route = format!("/tv/{tmdb_id}/season/{season}");
        let data = match self.fetch_json(&route, "", creds).await {
            Ok(v) => v,
            Err(e) => return json!({ "error": e }),
        };
        let eps: Vec<Value> = data["episodes"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|e| {
                let still = e["still_path"]
                    .as_str()
                    .map(|p| format!("https://image.tmdb.org/t/p/w780{p}"))
                    .unwrap_or_default();
                json!({
                    "number": e["episode_number"],
                    "title": e["name"].as_str().unwrap_or(""),
                    "overview": e["overview"].as_str().unwrap_or(""),
                    "still": still
                })
            })
            .collect();
        let out = json!({ "episodes": eps });
        let mut cache = self.es_cache.write().await;
        if cache.len() >= ES_CACHE_MAX {
            cache.clear();
        }
        cache.insert(
            key,
            CachedValue {
                at: Instant::now(),
                val: out.clone(),
            },
        );
        out
    }

    async fn cached_list(&self, key: &str, ttl: Duration) -> Option<Value> {
        let guard = self.list_cache.read().await;
        guard
            .get(key)
            .filter(|hit| hit.at.elapsed() < ttl)
            .map(|hit| json!({ "items": hit.val, "cached": true }))
    }

    async fn store_list(&self, key: &str, items: Value) {
        self.list_cache.write().await.insert(
            key.to_string(),
            CachedValue {
                at: Instant::now(),
                val: items,
            },
        );
    }

    /// Kids rows: all-ages titles (Mexico "AA"/"A", US "G"/"PG" fallback) with their IMDb id
    /// resolved, so Cinemeta and the stream plugins open them like any other title.
    async fn kids_list(&self, name: &str, spec: &KidsListSpec) -> Value {
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        if let Some(hit) = self.cached_list(name, CACHE_TTL).await {
            return hit;
        }

        let mut raw: Vec<Value> = Vec::new();
        let mut first_err: Option<String> = None;
        let mut routes = vec![spec.primary.as_str()];
        if let Some(fb) = spec.fallback.as_deref() {
            routes.push(fb);
        }
        for (i, route) in routes.iter().enumerate() {
            if i > 0 && raw.iter().filter(|r| kids_candidate_ok(r)).count() >= KIDS_MIN_ITEMS {
                break;
            }
            for page in 1..=2 {
                match self.fetch_json(route, &format!("&page={page}"), creds).await {
                    Ok(json) => {
                        let res = json["results"].as_array().cloned().unwrap_or_default();
                        let empty = res.is_empty();
                        for r in res {
                            if !raw.iter().any(|x| x["id"] == r["id"]) {
                                raw.push(r);
                            }
                        }
                        if empty {
                            break;
                        }
                    }
                    Err(e) => {
                        first_err.get_or_insert(e);
                        break;
                    }
                }
            }
        }
        if raw.is_empty() {
            return json!({ "error": first_err.unwrap_or_else(|| "Sin resultados".to_string()) });
        }

        let candidates: Vec<Value> = raw
            .into_iter()
            .filter(kids_candidate_ok)
            .take(ROW_MAX_ITEMS + 8)
            .collect();
        let kind = spec.kind;
        let resolved: Vec<Option<Value>> = stream::iter(candidates)
            .map(|r| async move {
                let imdb = self.imdb_id(kind, &r["id"].to_string(), creds).await?;
                Some(kids_item(&r, kind, &imdb))
            })
            .buffered(6)
            .collect()
            .await;
        let items: Vec<Value> = resolved.into_iter().flatten().take(ROW_MAX_ITEMS).collect();
        let items_val = Value::Array(items);
        self.store_list(name, items_val.clone()).await;
        json!({ "items": items_val })
    }

    async fn imdb_id(&self, kind: &str, tmdb_id: &str, creds: &TmdbCreds) -> Option<String> {
        if tmdb_id.is_empty() || !tmdb_id.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let key = format!("{kind}:{tmdb_id}");
        if let Some(hit) = self.ids_cache.read().await.get(&key) {
            return (!hit.is_empty()).then(|| hit.clone());
        }
        // Network errors are not cached (retried next time); a missing id is.
        let data = self
            .fetch_json(&format!("/{kind}/{tmdb_id}/external_ids"), "", creds)
            .await
            .ok()?;
        let imdb = data["imdb_id"]
            .as_str()
            .filter(|s| is_imdb_id(s))
            .unwrap_or("")
            .to_string();
        let mut cache = self.ids_cache.write().await;
        if cache.len() >= IDS_CACHE_MAX {
            cache.clear();
        }
        cache.insert(key, imdb.clone());
        (!imdb.is_empty()).then_some(imdb)
    }

    /// Most-followed anime of the current season on Kitsu (previous season appended early in
    /// a season, while the new one has few entries). Kitsu's own "trending" endpoint (and the
    /// plugin's `kitsu-anime-trending` catalog) is an all-time ranking that never moves.
    async fn anime_season(&self) -> Value {
        if let Some(hit) = self.cached_list(ANIME_SEASON_LIST, ANIME_CACHE_TTL).await {
            return hit;
        }
        let (year, month) = utc_year_month(SystemTime::now());
        let (season, season_year) = anime_season_for(year, month);
        let (prev, prev_year) = previous_anime_season(season, season_year);

        let mut items: Vec<Value> = Vec::new();
        let mut first_err: Option<String> = None;
        // One page each: Kitsu ignores `page[offset]` when sorting by `userCount`.
        for (i, (s, y)) in [(season, season_year), (prev, prev_year)].into_iter().enumerate() {
            if i == 1 && items.len() >= 12 {
                break;
            }
            match self.kitsu_page(&kitsu_season_url(s, y)).await {
                Ok(list) => {
                    for it in list {
                        if items.len() < ROW_MAX_ITEMS
                            && !items.iter().any(|x| x["kitsuId"] == it["kitsuId"])
                        {
                            items.push(it);
                        }
                    }
                }
                Err(e) => {
                    first_err.get_or_insert(e);
                }
            }
        }
        if items.is_empty() {
            return json!({ "error": first_err.unwrap_or_else(|| "Sin resultados".to_string()) });
        }
        let items_val = Value::Array(items);
        self.store_list(ANIME_SEASON_LIST, items_val.clone()).await;
        json!({ "items": items_val })
    }

    async fn kitsu_page(&self, url: &str) -> Result<Vec<Value>, String> {
        let resp = self
            .http
            .get(url)
            .timeout(Duration::from_secs(10))
            // Kitsu's JSON:API answers 406 to a plain `application/json` Accept.
            .header("Accept", "application/vnd.api+json")
            .send()
            .await
            .map_err(|_| "Sin conexión con Kitsu".to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Kitsu respondió {}", resp.status().as_u16()));
        }
        let json = resp
            .json::<Value>()
            .await
            .map_err(|_| "Respuesta de Kitsu no válida".to_string())?;
        Ok(json["data"]
            .as_array()
            .map(|a| a.iter().filter_map(kitsu_item).collect())
            .unwrap_or_default())
    }

    async fn raw_route(&self, route: &str) -> Value {
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let clean = if route.starts_with('/') {
            route.to_string()
        } else {
            format!("/{route}")
        };
        match self.fetch_json(&clean, "", creds).await {
            Ok(item) => json!({ "item": item }),
            Err(e) => json!({ "error": e }),
        }
    }
}

fn slim(r: &Value, kind: &str) -> Value {
    let date = r["release_date"]
        .as_str()
        .or_else(|| r["first_air_date"].as_str())
        .unwrap_or("");
    let title = r["title"]
        .as_str()
        .or_else(|| r["name"].as_str())
        .unwrap_or("");
    let original = r["original_title"]
        .as_str()
        .or_else(|| r["original_name"].as_str())
        .unwrap_or("");
    let rating = r["vote_average"]
        .as_f64()
        .map(|v| (v * 10.0).round() / 10.0)
        .unwrap_or(0.0);
    let poster = r["poster_path"]
        .as_str()
        .map(|p| format!("https://image.tmdb.org/t/p/w342{p}"))
        .unwrap_or_default();
    let backdrop = r["backdrop_path"]
        .as_str()
        .map(|p| format!("https://image.tmdb.org/t/p/w780{p}"))
        .unwrap_or_default();
    json!({
        "tmdbId": r["id"],
        "kind": kind,
        "date": date,
        "title": title,
        "original": original,
        "year": date.get(..4).unwrap_or(""),
        "rating": rating,
        "poster": poster,
        "backdrop": backdrop
    })
}

/// Mexico's all-ages ratings: "AA" (children) and "A" (all audiences).
const MX_ALL_AGES: &str = "certification_country=MX&certification=AA|A";
/// US equivalents, used only when Mexico has too few rated titles for a row.
const US_ALL_AGES: &str = "certification_country=US&certification=G|PG";
/// Never in Kids: horror, thriller, crime, war, romance.
const KIDS_MOVIE_SAFE: &str = "include_adult=false&without_genres=27,53,80,10752,10749";
/// TV has no certification filter on TMDB: Kids genre (10762) required, crime/war and the
/// "adult animation" keyword (161919) excluded.
const KIDS_TV_SAFE: &str =
    "include_adult=false&with_genres=10762&without_genres=80,10768&without_keywords=161919";

#[derive(Debug, Clone, PartialEq)]
pub struct KidsListSpec {
    pub kind: &'static str,
    pub primary: String,
    pub fallback: Option<String>,
}

/// Discover queries behind each Kids row (`None` = not a Kids list).
pub fn kids_list_spec(name: &str) -> Option<KidsListSpec> {
    let movie = |genres: &str, sort: &str, extra: &str| KidsListSpec {
        kind: "movie",
        primary: format!(
            "/discover/movie?{MX_ALL_AGES}&with_genres={genres}&{KIDS_MOVIE_SAFE}&sort_by={sort}{extra}"
        ),
        // US PG is broader than Mexico's "A": the fallback also requires the Family genre.
        fallback: Some(format!(
            "/discover/movie?{US_ALL_AGES}&with_genres={}&{KIDS_MOVIE_SAFE}&sort_by={sort}{extra}",
            if genres == "10751" { "10751".to_string() } else { format!("{genres},10751") }
        )),
    };
    let tv = |sort: &str, extra: &str| KidsListSpec {
        kind: "tv",
        primary: format!("/discover/tv?{KIDS_TV_SAFE}&sort_by={sort}{extra}"),
        fallback: None,
    };
    Some(match name {
        "kids-movies-popular" => movie("10751", "popularity.desc", "&vote_count.gte=50"),
        "kids-movies-animated" => movie("16", "vote_count.desc", ""),
        "kids-tv-popular" => tv("popularity.desc", "&vote_count.gte=20"),
        "kids-tv-top" => tv("vote_average.desc", "&vote_count.gte=150"),
        _ => return None,
    })
}

/// Kids row filter: no adult flag, needs title + poster, and no Japanese animation (anime
/// only goes to the Anime section).
pub fn kids_candidate_ok(r: &Value) -> bool {
    if r["adult"].as_bool().unwrap_or(false) || r["poster_path"].as_str().unwrap_or("").is_empty() {
        return false;
    }
    let title = r["title"].as_str().or_else(|| r["name"].as_str()).unwrap_or("");
    if title.trim().is_empty() {
        return false;
    }
    // No Latin letter at all means TMDB had no Spanish/English title (e.g. "超獣戦隊ライブマン"):
    // a kid can't read it and it is almost always a regional live-action show.
    if !title
        .chars()
        .any(|c| c.is_ascii_alphabetic() || ('\u{00C0}'..='\u{024F}').contains(&c))
    {
        return false;
    }
    let animated = r["genre_ids"]
        .as_array()
        .is_some_and(|g| g.iter().any(|x| x.as_u64() == Some(16)));
    let japanese = r["original_language"].as_str() == Some("ja")
        || r["origin_country"]
            .as_array()
            .is_some_and(|c| c.iter().any(|x| x.as_str() == Some("JP")));
    !(animated && japanese)
}

fn is_imdb_id(s: &str) -> bool {
    s.len() >= 7 && s.starts_with("tt") && s[2..].chars().all(|c| c.is_ascii_digit())
}

/// English genre names (the clients translate them, same as Cinemeta's).
fn genre_name(id: u64) -> Option<&'static str> {
    Some(match id {
        28 => "Action",
        12 | 10759 => "Adventure",
        16 => "Animation",
        35 => "Comedy",
        99 => "Documentary",
        18 => "Drama",
        10751 => "Family",
        14 => "Fantasy",
        36 => "History",
        10402 => "Music",
        9648 => "Mystery",
        878 | 10765 => "Sci-Fi",
        37 => "Western",
        _ => return None,
    })
}

fn kids_item(r: &Value, kind: &str, imdb: &str) -> Value {
    let base = slim(r, kind);
    let backdrop = r["backdrop_path"]
        .as_str()
        .map(|p| format!("https://image.tmdb.org/t/p/w1280{p}"))
        .unwrap_or_default();
    let mut genres: Vec<&str> = Vec::new();
    for g in r["genre_ids"].as_array().into_iter().flatten().filter_map(|g| g.as_u64()) {
        if let Some(n) = genre_name(g) {
            if !genres.contains(&n) {
                genres.push(n);
            }
        }
    }
    json!({
        "tmdbId": base["tmdbId"],
        "kind": kind,
        "imdbId": imdb,
        "title": base["title"],
        "original": base["original"],
        "year": base["year"],
        "rating": base["rating"],
        "overview": r["overview"].as_str().unwrap_or(""),
        "poster": base["poster"],
        "backdrop": backdrop,
        "genres": genres
    })
}

/// Kitsu anime season ("winter" Jan-Mar ... "fall" Oct-Dec) for a calendar month.
pub fn anime_season_for(year: i32, month: u32) -> (&'static str, i32) {
    let season = match month {
        1..=3 => "winter",
        4..=6 => "spring",
        7..=9 => "summer",
        _ => "fall",
    };
    (season, year)
}

pub fn previous_anime_season(season: &str, year: i32) -> (&'static str, i32) {
    match season {
        "winter" => ("fall", year - 1),
        "spring" => ("winter", year),
        "summer" => ("spring", year),
        _ => ("summer", year),
    }
}

fn kitsu_season_url(season: &str, year: i32) -> String {
    format!(
        "https://kitsu.app/api/edge/anime?filter[season]={season}&filter[seasonYear]={year}\
         &sort=-userCount&page[limit]=20\
         &fields[anime]=titles,canonicalTitle,startDate,subtype,ageRating,nsfw,averageRating,posterImage,coverImage,synopsis"
    )
}

/// Calendar (year, month) in UTC without pulling a date crate (civil-from-days).
pub fn utc_year_month(now: SystemTime) -> (i32, u32) {
    let days = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = (yoe + era * 400 + if month <= 2 { 1 } else { 0 }) as i32;
    (year, month)
}

fn kitsu_image(v: &Value) -> String {
    ["large", "original", "medium"]
        .iter()
        .find_map(|k| v[*k].as_str().filter(|s| s.starts_with("https://")))
        .unwrap_or("")
        .to_string()
}

/// One Kitsu JSON:API anime -> row item; adult (`nsfw`/R18) or poster-less entries dropped.
pub fn kitsu_item(d: &Value) -> Option<Value> {
    let id = d["id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))?;
    let a = &d["attributes"];
    if a["nsfw"].as_bool().unwrap_or(false) || a["ageRating"].as_str() == Some("R18") {
        return None;
    }
    let poster = kitsu_image(&a["posterImage"]);
    if poster.is_empty() {
        return None;
    }
    let titles = &a["titles"];
    let canonical = a["canonicalTitle"].as_str().unwrap_or("").trim();
    let title = ["es", "es_mx", "es_es", "en", "en_us"]
        .iter()
        .find_map(|k| titles[*k].as_str().map(str::trim).filter(|s| !s.is_empty()))
        .unwrap_or(canonical);
    if title.is_empty() {
        return None;
    }
    // Kitsu rates 0-100; the app shows a 0-10 score with one decimal.
    let rating = a["averageRating"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|v| v.round() / 10.0)
        .unwrap_or(0.0);
    Some(json!({
        "kitsuId": id,
        "title": title,
        "original": canonical,
        "year": a["startDate"].as_str().unwrap_or("").get(..4).unwrap_or(""),
        "rating": rating,
        "overview": a["synopsis"].as_str().unwrap_or(""),
        "poster": poster,
        "backdrop": kitsu_image(&a["coverImage"]),
        "subtype": a["subtype"].as_str().unwrap_or("")
    }))
}

fn load_credentials(explicit: Option<PathBuf>, inline_json: Option<&str>) -> Option<TmdbCreds> {
    if let Some(raw) = inline_json {
        if let Ok(parsed) = serde_json::from_str::<TmdbCreds>(raw) {
            if !parsed.read_access_token.is_empty() || !parsed.api_key.is_empty() {
                return Some(parsed);
            }
        }
    }
    let env_tok = std::env::var("OPENTV_TMDB_TOKEN").unwrap_or_default();
    let env_key = std::env::var("OPENTV_TMDB_KEY").unwrap_or_default();
    if !env_tok.is_empty() || !env_key.is_empty() {
        return Some(TmdbCreds {
            read_access_token: env_tok,
            api_key: env_key,
        });
    }
    let mut candidates = Vec::new();
    if let Some(p) = explicit {
        candidates.push(p);
    }
    candidates.push(PathBuf::from("config/tmdb.json"));
    for path in candidates {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<TmdbCreds>(&text) {
                if !parsed.read_access_token.is_empty() || !parsed.api_key.is_empty() {
                    return Some(parsed);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kids_movies_use_mexican_all_ages_with_us_fallback() {
        let spec = kids_list_spec("kids-movies-popular").unwrap();
        assert_eq!(spec.kind, "movie");
        assert!(spec.primary.contains("certification_country=MX&certification=AA|A"));
        assert!(spec.primary.contains("with_genres=10751&"));
        assert!(spec.primary.contains("include_adult=false"));
        assert!(spec.primary.contains("without_genres=27,53,80,10752,10749"));
        assert!(!spec.primary.contains("PG-13"));
        let fb = spec.fallback.unwrap();
        assert!(fb.contains("certification_country=US&certification=G|PG"));
        assert!(fb.contains("with_genres=10751&"));

        let animated = kids_list_spec("kids-movies-animated").unwrap();
        assert!(animated.primary.contains("with_genres=16&"));
        // The broader US fallback only takes animated *family* films.
        assert!(animated.fallback.unwrap().contains("with_genres=16,10751&"));
    }

    #[test]
    fn kids_tv_requires_kids_genre_and_excludes_adult_animation() {
        for name in ["kids-tv-popular", "kids-tv-top"] {
            let spec = kids_list_spec(name).unwrap();
            assert_eq!(spec.kind, "tv");
            assert!(spec.primary.starts_with("/discover/tv?"));
            assert!(spec.primary.contains("with_genres=10762"));
            assert!(spec.primary.contains("without_keywords=161919"));
            assert!(spec.primary.contains("include_adult=false"));
            assert!(spec.fallback.is_none());
        }
        assert!(kids_list_spec("movie-week").is_none());
    }

    #[test]
    fn kids_filter_drops_anime_adult_and_posterless() {
        let ok = json!({ "title": "Coco", "poster_path": "/a.jpg", "genre_ids": [16, 10751], "original_language": "en" });
        let anime = json!({ "name": "Doraemon", "poster_path": "/a.jpg", "genre_ids": [16, 10762], "original_language": "ja" });
        let anime_jp = json!({ "name": "Pokemon", "poster_path": "/a.jpg", "genre_ids": [16], "original_language": "en", "origin_country": ["JP"] });
        let adult = json!({ "title": "X", "poster_path": "/a.jpg", "adult": true });
        let no_poster = json!({ "title": "Y", "genre_ids": [10751] });
        let ja_live = json!({ "title": "Z", "poster_path": "/a.jpg", "genre_ids": [10751], "original_language": "ja" });
        assert!(kids_candidate_ok(&ok));
        assert!(!kids_candidate_ok(&anime));
        assert!(!kids_candidate_ok(&anime_jp));
        assert!(!kids_candidate_ok(&adult));
        assert!(!kids_candidate_ok(&no_poster));
        assert!(kids_candidate_ok(&ja_live));
        let untranslated = json!({ "name": "超獣戦隊ライブマン", "poster_path": "/a.jpg", "genre_ids": [10762], "original_language": "ja" });
        assert!(!kids_candidate_ok(&untranslated));
        let accented = json!({ "title": "Érase una vez", "poster_path": "/a.jpg", "genre_ids": [10751], "original_language": "es" });
        assert!(kids_candidate_ok(&accented));
    }

    #[test]
    fn kids_item_maps_genres_and_large_backdrop() {
        let r = json!({ "id": 354912, "title": "Coco", "release_date": "2017-10-27", "poster_path": "/p.jpg",
            "backdrop_path": "/b.jpg", "genre_ids": [10751, 16, 99999], "overview": "Miguel", "vote_average": 8.21 });
        let it = kids_item(&r, "movie", "tt2380307");
        assert_eq!(it["imdbId"], "tt2380307");
        assert_eq!(it["year"], "2017");
        assert_eq!(it["backdrop"], "https://image.tmdb.org/t/p/w1280/b.jpg");
        assert_eq!(it["genres"], json!(["Family", "Animation"]));
        assert!(is_imdb_id("tt2380307"));
        assert!(!is_imdb_id("tt12"));
        assert!(!is_imdb_id(""));
    }

    #[test]
    fn anime_seasons_follow_the_calendar() {
        assert_eq!(anime_season_for(2026, 1), ("winter", 2026));
        assert_eq!(anime_season_for(2026, 5), ("spring", 2026));
        assert_eq!(anime_season_for(2026, 9), ("summer", 2026));
        assert_eq!(anime_season_for(2026, 11), ("fall", 2026));
        assert_eq!(previous_anime_season("winter", 2027), ("fall", 2026));
        assert_eq!(previous_anime_season("fall", 2026), ("summer", 2026));
        let url = kitsu_season_url("fall", 2026);
        assert!(url.contains("filter[season]=fall&filter[seasonYear]=2026&sort=-userCount&page[limit]=20&"));
        assert!(!url.contains(' '));
    }

    #[test]
    fn utc_year_month_is_correct() {
        let at = |secs: u64| UNIX_EPOCH + Duration::from_secs(secs);
        assert_eq!(utc_year_month(at(0)), (1970, 1));
        assert_eq!(utc_year_month(at(1_709_208_000)), (2024, 2)); // 2024-02-29 12:00
        assert_eq!(utc_year_month(at(1_798_675_200)), (2026, 12)); // 2026-12-31
        assert_eq!(utc_year_month(at(1_798_761_600)), (2027, 1)); // 2027-01-01
    }

    #[test]
    fn kitsu_item_prefers_readable_titles_and_drops_adult() {
        let d = json!({ "id": "50021", "attributes": {
            "titles": { "en": "The Apothecary Diaries Season 3", "en_jp": "Kusuriya no Hitorigoto 3" },
            "canonicalTitle": "Kusuriya no Hitorigoto 3", "startDate": "2026-10-03", "averageRating": "84.37",
            "posterImage": { "large": "https://media.kitsu.app/p.jpg" }, "coverImage": null, "subtype": "TV" } });
        let it = kitsu_item(&d).unwrap();
        assert_eq!(it["kitsuId"], "50021");
        assert_eq!(it["title"], "The Apothecary Diaries Season 3");
        assert_eq!(it["year"], "2026");
        assert_eq!(it["rating"], 8.4);
        assert_eq!(it["backdrop"], "");
        let mut adult = d.clone();
        adult["attributes"]["ageRating"] = json!("R18");
        assert!(kitsu_item(&adult).is_none());
        let mut nsfw = d.clone();
        nsfw["attributes"]["nsfw"] = json!(true);
        assert!(kitsu_item(&nsfw).is_none());
        let mut no_poster = d.clone();
        no_poster["attributes"]["posterImage"] = Value::Null;
        assert!(kitsu_item(&no_poster).is_none());
    }
}
