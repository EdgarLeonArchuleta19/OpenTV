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
/// Search screen results resolved to IMDb ids (one cached `external_ids` lookup each).
const FIND_MAX_ITEMS: usize = 24;
const IDS_CACHE_MAX: usize = 3000;
/// Seasonal anime ranks move every few days: refresh more often than the TMDB lists.
const ANIME_CACHE_TTL: Duration = Duration::from_secs(3 * 60 * 60);
/// Items per Kids/Anime row (each Kids item costs one `external_ids` lookup, cached).
const ROW_MAX_ITEMS: usize = 24;
/// Below this many Mexican-rated results the US G/PG fallback query is appended.
const KIDS_MIN_ITEMS: usize = 16;
pub const ANIME_SEASON_LIST: &str = "anime-season";
/// Related titles on the detail page (recommendations, then similar).
const DETAIL_RELATED_MAX: usize = 12;
/// Cast names on the detail page.
const DETAIL_CAST_MAX: usize = 8;
const LIST_CACHE_MAX: usize = 300;
/// TMDB discover filter shared by every Anime row (Japanese animation only).
const ANIME_DISCOVER: &str = "with_genres=16&with_original_language=ja&include_adult=false";
const NOT_ALLOWED: &str = "Lista no permitida";

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
        if let Some(q) = name.strip_prefix("find:") {
            return self.find(q).await;
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
        if let Some(imdb) = name.strip_prefix("detail:") {
            return self.detail(imdb).await;
        }
        if let Some(rest) = name.strip_prefix("episodes:") {
            return match parse_episodes_name(rest) {
                Some((tv_id, season)) => self.episodes(tv_id, season).await,
                None => json!({ "error": "Id no válido" }),
            };
        }
        if name.starts_with("cat:") || name.starts_with("anime:") {
            let today = days_since_epoch(SystemTime::now());
            return match row_list_spec(name, today) {
                Ok(spec) => self.row_list(name, &spec).await,
                Err(e) => json!({ "error": e }),
            };
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
        // Prefixed like `find:` so a query typed as "find:…" never reads the other's entry.
        let key = format!("search:{}", q.to_lowercase());
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

    /// Search screen results: TMDB relevance (Spanish titles, real posters), only titles with a
    /// poster, some audience and an IMDb id, so every result opens and can find sources.
    /// Cinemeta's own search returns fan shows and dead artwork for queries like "the flash".
    async fn find(&self, text: &str) -> Value {
        let q: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let q: String = q.chars().take(100).collect();
        if q.chars().count() < 2 {
            return json!({ "items": [] });
        }
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let key = format!("find:{}", q.to_lowercase());
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
        let mut raw = Vec::new();
        for page in 1..=2 {
            match self.fetch_page(&route, page, creds).await {
                Ok(mut res) => {
                    let short = res.len() < 20;
                    raw.append(&mut res);
                    if short {
                        break;
                    }
                }
                Err(e) if raw.is_empty() => return json!({ "error": e }),
                Err(_) => break,
            }
        }
        let candidates: Vec<(String, Value)> = raw
            .into_iter()
            .filter_map(|r| {
                let mt = r["media_type"].as_str()?.to_string();
                find_candidate_ok(&r, &mt).then_some((mt, r))
            })
            .take(FIND_MAX_ITEMS + 6)
            .collect();
        let resolved: Vec<Option<Value>> = stream::iter(candidates)
            .map(|(mt, r)| async move {
                let imdb = self.imdb_id(&mt, &r["id"].to_string(), creds).await?;
                Some(kids_item(&r, if mt == "tv" { "tv" } else { "movie" }, &imdb))
            })
            .buffered(8)
            .collect()
            .await;
        let items: Vec<Value> = resolved.into_iter().flatten().take(FIND_MAX_ITEMS).collect();
        let items_val = Value::Array(items);
        let mut cache = self.search_cache.write().await;
        if cache.len() >= SEARCH_CACHE_MAX {
            cache.clear();
        }
        cache.insert(key, CachedValue { at: Instant::now(), val: items_val.clone() });
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
        let mut cache = self.list_cache.write().await;
        // Genre rows make the key space open-ended (numeric ids): keep it bounded.
        if cache.len() >= LIST_CACHE_MAX && !cache.contains_key(key) {
            cache.clear();
        }
        cache.insert(
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

        let today = today_string();
        let mut raw: Vec<Value> = Vec::new();
        let mut first_err: Option<String> = None;
        let mut routes = vec![spec.primary.as_str()];
        if let Some(fb) = spec.fallback.as_deref() {
            routes.push(fb);
        }
        for (i, route) in routes.iter().enumerate() {
            if i > 0 && raw.iter().filter(|r| kids_candidate_ok(r) && released_by(r, &today)).count() >= KIDS_MIN_ITEMS {
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
            .filter(|r| kids_candidate_ok(r) && released_by(r, &today))
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

    /// TMDB-first catalog (`cat:*`) and anime (`anime:*`) rows: items with a poster and an
    /// IMDb id, so every card opens and finds sources through the stream plugins.
    async fn row_list(&self, name: &str, spec: &RowSpec) -> Value {
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let ttl = if spec.anime { ANIME_CACHE_TTL } else { CACHE_TTL };
        if let Some(hit) = self.cached_list(name, ttl).await {
            return hit;
        }

        let today = today_string();
        let mut raw: Vec<Value> = Vec::new();
        let mut first_err: Option<String> = None;
        for (i, route) in spec.routes.iter().enumerate() {
            let usable = raw.iter().filter(|r| row_candidate_ok(r, spec.exclude_anime) && released_by(r, &today)).count();
            if i > 0 && usable >= ROW_MAX_ITEMS {
                break;
            }
            for page in 1..=2 {
                match self.fetch_page(route, page, creds).await {
                    Ok(res) => {
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
            if let Some(e) = first_err {
                return json!({ "error": e });
            }
            let empty = Value::Array(Vec::new());
            self.store_list(name, empty.clone()).await;
            return json!({ "items": empty });
        }

        let candidates: Vec<Value> = raw
            .into_iter()
            .filter(|r| row_candidate_ok(r, spec.exclude_anime) && released_by(r, &today))
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

    /// Title page from TMDB: Spanish metadata, credits, seasons and related titles.
    async fn detail(&self, imdb: &str) -> Value {
        if !is_imdb_id(imdb) {
            return json!({ "error": "Id no válido" });
        }
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let key = format!("d:{imdb}");
        {
            let guard = self.es_cache.read().await;
            if let Some(hit) = guard.get(&key) {
                if hit.at.elapsed() < CACHE_TTL {
                    return hit.val.clone();
                }
            }
        }
        let found = match self
            .fetch_json(&format!("/find/{imdb}?external_source=imdb_id"), "", creds)
            .await
        {
            Ok(v) => v,
            Err(e) => return json!({ "error": e }),
        };
        let movie_hit = found["movie_results"].as_array().and_then(|a| a.first());
        let tv_hit = found["tv_results"].as_array().and_then(|a| a.first());
        let (kind, tmdb_id) = match (movie_hit, tv_hit) {
            (Some(m), _) => ("movie", m["id"].as_u64()),
            (None, Some(t)) => ("tv", t["id"].as_u64()),
            _ => ("movie", None),
        };
        let Some(tmdb_id) = tmdb_id else {
            return json!({ "error": "Título no encontrado en TMDB" });
        };
        let data = match self
            .fetch_json(
                &format!("/{kind}/{tmdb_id}"),
                "&append_to_response=credits,recommendations,similar",
                creds,
            )
            .await
        {
            Ok(v) => v,
            Err(e) => return json!({ "error": e }),
        };

        let mut out = detail_from(kind, imdb, &data);
        let candidates = related_candidates(kind, &data, DETAIL_RELATED_MAX + 6);
        let resolved: Vec<Option<Value>> = stream::iter(candidates)
            .map(|r: Value| async move {
                let k = if r["media_type"].as_str() == Some("tv") { "tv" } else { "movie" };
                let id = self.imdb_id(k, &r["id"].to_string(), creds).await?;
                Some(kids_item(&r, k, &id))
            })
            .buffered(6)
            .collect()
            .await;
        let related: Vec<Value> = resolved
            .into_iter()
            .flatten()
            .filter(|it| it["imdbId"].as_str() != Some(imdb))
            .take(DETAIL_RELATED_MAX)
            .collect();
        out["related"] = Value::Array(related);

        let mut cache = self.es_cache.write().await;
        if cache.len() >= ES_CACHE_MAX {
            cache.clear();
        }
        cache.insert(key, CachedValue { at: Instant::now(), val: out.clone() });
        out
    }

    /// One season's episodes (Spanish titles/overviews, stills, air dates, runtimes).
    async fn episodes(&self, tv_id: u64, season: u32) -> Value {
        let Some(creds) = &self.creds else {
            return json!({ "error": "Sin clave de TMDB", "unavailable": true });
        };
        let key = format!("e:{tv_id}:{season}");
        {
            let guard = self.es_cache.read().await;
            if let Some(hit) = guard.get(&key) {
                if hit.at.elapsed() < CACHE_TTL {
                    return hit.val.clone();
                }
            }
        }
        let data = match self
            .fetch_json(&format!("/tv/{tv_id}/season/{season}"), "", creds)
            .await
        {
            Ok(v) => v,
            Err(e) => return json!({ "error": e }),
        };
        let out = json!({ "episodes": map_episodes(season, &data) });
        let mut cache = self.es_cache.write().await;
        if cache.len() >= ES_CACHE_MAX {
            cache.clear();
        }
        cache.insert(key, CachedValue { at: Instant::now(), val: out.clone() });
        out
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

/// Discover/list queries behind a `cat:*` or `anime:*` row.
#[derive(Debug, Clone, PartialEq)]
pub struct RowSpec {
    pub kind: &'static str,
    /// Tried in order; later routes only top up a short row.
    pub routes: Vec<String>,
    /// Owner rule (anime only in Anime): catalog rows drop Japanese animation.
    pub exclude_anime: bool,
    /// Anime rows refresh more often (seasonal ranks move every few days).
    pub anime: bool,
}

fn is_numeric_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 9 && s.chars().all(|c| c.is_ascii_digit())
}

/// Parses a `cat:*` / `anime:*` list name. `today` is days since the Unix epoch (UTC),
/// used by the seasonal and "airing" anime windows.
pub fn row_list_spec(name: &str, today: i64) -> Result<RowSpec, &'static str> {
    if let Some(rest) = name.strip_prefix("cat:") {
        let mut parts = rest.splitn(3, ':');
        let kind = match parts.next() {
            Some("movie") => "movie",
            Some("tv") => "tv",
            _ => return Err(NOT_ALLOWED),
        };
        let route = match (parts.next(), parts.next()) {
            (Some("trending"), None) => format!("/trending/{kind}/week"),
            (Some("popular"), None) => format!("/{kind}/popular"),
            (Some("top"), None) => format!("/{kind}/top_rated"),
            (Some("genre"), Some(id)) if is_numeric_id(id) => format!(
                "/discover/{kind}?with_genres={id}&sort_by=popularity.desc&vote_count.gte=50&include_adult=false"
            ),
            _ => return Err(NOT_ALLOWED),
        };
        return Ok(RowSpec { kind, routes: vec![route], exclude_anime: true, anime: false });
    }
    let Some(which) = name.strip_prefix("anime:") else {
        return Err(NOT_ALLOWED);
    };
    let tv = |extra: &str| format!("/discover/tv?{ANIME_DISCOVER}&{extra}");
    let (kind, routes) = match which {
        "season" => {
            let (y, m, _) = ymd_from_days(today);
            let (season, year) = anime_season_for(y, m);
            let (from, to) = anime_season_window(season, year);
            (
                "tv",
                vec![
                    // Shows that premiere this season first, then continuing shows on air.
                    tv(&format!(
                        "first_air_date.gte={from}&first_air_date.lte={to}&sort_by=popularity.desc"
                    )),
                    tv(&format!("air_date.gte={from}&air_date.lte={to}&sort_by=popularity.desc")),
                ],
            )
        }
        "airing" => {
            let from = date_string(today - 7);
            let to = date_string(today);
            ("tv", vec![tv(&format!("air_date.gte={from}&air_date.lte={to}&sort_by=popularity.desc"))])
        }
        "popular" => ("tv", vec![tv("sort_by=popularity.desc")]),
        "top" => ("tv", vec![tv("sort_by=vote_average.desc&vote_count.gte=200")]),
        "movies" => (
            "movie",
            vec![format!("/discover/movie?{ANIME_DISCOVER}&sort_by=popularity.desc")],
        ),
        _ => return Err(NOT_ALLOWED),
    };
    Ok(RowSpec { kind, routes, exclude_anime: false, anime: true })
}

/// Japanese animation (genre 16 + original language "ja"): only ever shown in Anime.
pub fn is_japanese_animation(r: &Value) -> bool {
    let animated = r["genre_ids"]
        .as_array()
        .is_some_and(|g| g.iter().any(|x| x.as_u64() == Some(16)))
        || r["genres"]
            .as_array()
            .is_some_and(|g| g.iter().any(|x| x["id"].as_u64() == Some(16)));
    animated && r["original_language"].as_str() == Some("ja")
}

/// A catalog/anime row candidate: not adult, has a title and a poster; catalog rows also
/// drop Japanese animation.
pub fn row_candidate_ok(r: &Value, exclude_anime: bool) -> bool {
    if r["adult"].as_bool().unwrap_or(false) || r["poster_path"].as_str().unwrap_or("").is_empty() {
        return false;
    }
    let title = r["title"].as_str().or_else(|| r["name"].as_str()).unwrap_or("");
    // No Latin letter means TMDB has no Spanish/English title ("ちびまる子ちゃん"): skip it,
    // as Kids does, so rows never show untranslated names.
    let has_latin = title
        .chars()
        .any(|c| c.is_ascii_alphabetic() || ('\u{00C0}'..='\u{024F}').contains(&c));
    if title.trim().is_empty() || !has_latin {
        return false;
    }
    !(exclude_anime && is_japanese_animation(r))
}

/// `episodes:<tmdbTvId>:<season>` -> (id, season).
pub fn parse_episodes_name(rest: &str) -> Option<(u64, u32)> {
    let (id, season) = rest.split_once(':')?;
    if !is_numeric_id(id) || season.is_empty() || season.len() > 4 || !season.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((id.parse().ok()?, season.parse().ok()?))
}

/// Maps `/movie/{id}` or `/tv/{id}` (with `append_to_response=credits,...`) to the detail
/// payload, without `related` (those need IMDb lookups).
pub fn detail_from(kind: &str, imdb: &str, data: &Value) -> Value {
    let mut item = kids_item(data, kind, imdb);
    let runtime = if kind == "movie" {
        data["runtime"].as_u64().unwrap_or(0)
    } else {
        data["episode_run_time"]
            .as_array()
            .and_then(|a| a.iter().find_map(|v| v.as_u64()))
            .or_else(|| data["last_episode_to_air"]["runtime"].as_u64())
            .unwrap_or(0)
    };
    item["runtime"] = json!(runtime);

    let names = |arr: &Value, keep: &dyn Fn(&Value) -> bool| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for p in arr.as_array().into_iter().flatten().filter(|p| keep(p)) {
            if let Some(n) = p["name"].as_str().map(str::trim).filter(|n| !n.is_empty()) {
                if !out.iter().any(|x| x == n) {
                    out.push(n.to_string());
                }
            }
        }
        out
    };
    let director = if kind == "movie" {
        names(&data["credits"]["crew"], &|p| p["job"].as_str() == Some("Director"))
    } else {
        names(&data["created_by"], &|_| true)
    };
    let mut cast = names(&data["credits"]["cast"], &|_| true);
    cast.truncate(DETAIL_CAST_MAX);

    let mut seasons: Vec<u64> = data["seasons"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s["season_number"].as_u64())
        .filter(|n| *n > 0)
        .collect();
    seasons.sort_unstable();
    seasons.dedup();

    json!({
        "tmdbId": data["id"],
        "item": item,
        "director": director,
        "cast": cast,
        "seasons": seasons,
        "related": []
    })
}

/// Recommendations then similar titles, deduplicated, with a poster (the anime rule does
/// not apply on the detail page). Each result gets its `media_type` set.
pub fn related_candidates(kind: &str, data: &Value, max: usize) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let today = today_string();
    for list in ["recommendations", "similar"] {
        for r in data[list]["results"].as_array().into_iter().flatten() {
            let k: &'static str = match r["media_type"].as_str().unwrap_or(kind) {
                "movie" => "movie",
                "tv" => "tv",
                _ => continue,
            };
            if r["id"] == data["id"] && k == kind {
                continue;
            }
            if !row_candidate_ok(r, false) || !released_by(r, &today) {
                continue;
            }
            if out.iter().any(|x| x["media_type"] == k && x["id"] == r["id"]) {
                continue;
            }
            let mut item = r.clone();
            item["media_type"] = json!(k);
            out.push(item);
            if out.len() >= max {
                return out;
            }
        }
    }
    out
}

/// `/tv/{id}/season/{n}` -> episode list.
pub fn map_episodes(season: u32, data: &Value) -> Vec<Value> {
    data["episodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let number = e["episode_number"].as_u64()?;
            let still = e["still_path"]
                .as_str()
                .filter(|p| !p.is_empty())
                .map(|p| format!("https://image.tmdb.org/t/p/w300{p}"))
                .unwrap_or_default();
            Some(json!({
                "season": e["season_number"].as_u64().unwrap_or(season as u64),
                "number": number,
                "title": e["name"].as_str().unwrap_or(""),
                "overview": e["overview"].as_str().unwrap_or(""),
                "still": still,
                "airDate": e["air_date"].as_str().unwrap_or(""),
                "runtime": e["runtime"].as_u64().unwrap_or(0)
            }))
        })
        .collect()
}

/// First and last day ("YYYY-MM-DD") of a Kitsu-style anime season.
pub fn anime_season_window(season: &str, year: i32) -> (String, String) {
    let (a, b) = match season {
        "winter" => ("01-01", "03-31"),
        "spring" => ("04-01", "06-30"),
        "summer" => ("07-01", "09-30"),
        _ => ("10-01", "12-31"),
    };
    (format!("{year:04}-{a}"), format!("{year:04}-{b}"))
}

fn is_imdb_id(s: &str) -> bool {
    s.len() >= 7 && s.len() <= 12 && s.starts_with("tt") && s[2..].chars().all(|c| c.is_ascii_digit())
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

/// A TMDB search hit worth showing: a movie or series with a poster and a minimal audience
/// (drops fan shows, reaction videos and empty placeholder entries).
fn find_candidate_ok(r: &Value, media_type: &str) -> bool {
    if media_type != "movie" && media_type != "tv" {
        return false;
    }
    if r["poster_path"].as_str().unwrap_or("").is_empty() {
        return false;
    }
    let votes = r["vote_count"].as_u64().unwrap_or(0);
    let popularity = r["popularity"].as_f64().unwrap_or(0.0);
    votes >= 15 || popularity >= 8.0
}

fn kids_item(r: &Value, kind: &str, imdb: &str) -> Value {
    let base = slim(r, kind);
    let backdrop = r["backdrop_path"]
        .as_str()
        .map(|p| format!("https://image.tmdb.org/t/p/w1280{p}"))
        .unwrap_or_default();
    let mut genres: Vec<&str> = Vec::new();
    // List results carry `genre_ids`; detail responses carry `genres: [{id, name}]`.
    let ids: Vec<u64> = match r["genre_ids"].as_array() {
        Some(a) => a.iter().filter_map(|g| g.as_u64()).collect(),
        None => r["genres"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|g| g["id"].as_u64())
            .collect(),
    };
    for g in ids {
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

/// Days since the Unix epoch (UTC).
pub fn days_since_epoch(now: SystemTime) -> i64 {
    now.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64
}

/// Calendar (year, month, day) for a day count since the epoch (civil-from-days).
pub fn ymd_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = (yoe + era * 400 + if month <= 2 { 1 } else { 0 }) as i32;
    (year, month, day)
}

/// Today in Mexico/Central time (UTC-6) as "YYYY-MM-DD", for comparing with TMDB release dates:
/// with plain UTC, tomorrow's premieres showed up around 6 p.m. the day before.
pub fn today_string() -> String {
    let now = SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(6 * 3600))
        .unwrap_or_else(SystemTime::now);
    date_string(days_since_epoch(now))
}

/// Already out: a movie's `release_date` / a series' `first_air_date` is on or before `today`
/// ("YYYY-MM-DD"). Rows never show titles that have not premiered (no sources exist yet).
pub fn released_by(r: &Value, today: &str) -> bool {
    let d = r["release_date"].as_str().or_else(|| r["first_air_date"].as_str()).unwrap_or("");
    d.len() >= 10 && d.is_char_boundary(10) && &d[..10] <= today
}

/// "YYYY-MM-DD" for a day count since the epoch.
pub fn date_string(days: i64) -> String {
    let (y, m, d) = ymd_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Calendar (year, month) in UTC without pulling a date crate.
pub fn utc_year_month(now: SystemTime) -> (i32, u32) {
    let (y, m, _) = ymd_from_days(days_since_epoch(now));
    (y, m)
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
    fn rows_only_show_released_titles() {
        let out = json!({"title": "Coco", "release_date": "2017-10-27"});
        let soon = json!({"title": "Avengers: Doomsday", "release_date": "2026-12-18"});
        let show = json!({"name": "The Flash", "first_air_date": "2014-10-07"});
        let undated = json!({"title": "Sin fecha"});
        assert!(released_by(&out, "2026-11-24"));
        assert!(!released_by(&soon, "2026-11-24"));
        assert!(released_by(&show, "2026-11-24"));
        assert!(!released_by(&undated, "2026-11-24"));
    }

    #[test]
    fn rows_skip_titles_without_latin_letters() {
        let jp = json!({"name": "ちびまる子ちゃん", "poster_path": "/a.jpg"});
        let ok = json!({"name": "Detective Conan", "poster_path": "/b.jpg"});
        assert!(!row_candidate_ok(&jp, false));
        assert!(row_candidate_ok(&ok, false));
    }

    #[test]
    fn find_keeps_real_titles_and_drops_fan_shows() {
        let show = json!({"id": 60735, "name": "The Flash", "poster_path": "/a.jpg", "vote_count": 12000, "popularity": 90.0});
        let fan = json!({"id": 1, "name": "The Flash Minecraft", "poster_path": "/b.jpg", "vote_count": 1, "popularity": 0.6});
        let no_art = json!({"id": 2, "title": "The Flash", "vote_count": 400, "popularity": 20.0});
        let person = json!({"id": 3, "name": "Barry Allen", "poster_path": "/c.jpg", "vote_count": 400});
        assert!(find_candidate_ok(&show, "tv"));
        assert!(!find_candidate_ok(&fan, "tv"));
        assert!(!find_candidate_ok(&no_art, "movie"));
        assert!(!find_candidate_ok(&person, "person"));
    }

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
        assert!(!is_imdb_id("tt12345678901234"));
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
    #[test]
    fn catalog_list_names_are_validated() {
        let today = 20_781; // 2026-11-24
        let s = row_list_spec("cat:movie:trending", today).unwrap();
        assert_eq!(s.kind, "movie");
        assert_eq!(s.routes, vec!["/trending/movie/week".to_string()]);
        assert!(s.exclude_anime && !s.anime);
        assert_eq!(row_list_spec("cat:tv:popular", today).unwrap().routes[0], "/tv/popular");
        assert_eq!(row_list_spec("cat:tv:top", today).unwrap().routes[0], "/tv/top_rated");
        assert_eq!(row_list_spec("cat:movie:top", today).unwrap().routes[0], "/movie/top_rated");
        let g = row_list_spec("cat:tv:genre:10765", today).unwrap();
        assert_eq!(g.kind, "tv");
        assert!(g.routes[0].starts_with("/discover/tv?with_genres=10765&sort_by=popularity.desc&vote_count.gte=50"));
        for bad in [
            "cat:movie:genre:12a", "cat:movie:genre:", "cat:movie:genre:1&x=2", "cat:person:popular",
            "cat:movie", "cat:movie:trending:x", "cat:movie:latest", "anime:", "anime:hentai", "cat:",
        ] {
            assert_eq!(row_list_spec(bad, today), Err("Lista no permitida"), "{bad}");
        }
    }

    #[test]
    fn anime_rows_use_japanese_animation_and_season_window() {
        let today = 20_781; // 2026-11-24
        assert_eq!(date_string(today), "2026-11-24");
        assert_eq!(date_string(today - 7), "2026-11-17");
        let season = row_list_spec("anime:season", today).unwrap();
        assert_eq!(season.kind, "tv");
        assert!(season.anime && !season.exclude_anime);
        assert!(season.routes[0].contains("with_genres=16&with_original_language=ja"));
        assert!(season.routes[0].contains("first_air_date.gte=2026-10-01&first_air_date.lte=2026-12-31"));
        assert!(season.routes[1].contains("air_date.gte=2026-10-01&air_date.lte=2026-12-31"));
        let airing = row_list_spec("anime:airing", today).unwrap();
        assert!(airing.routes[0].contains("air_date.gte=2026-11-17&air_date.lte=2026-11-24"));
        assert!(row_list_spec("anime:top", today).unwrap().routes[0].contains("vote_count.gte=200"));
        let movies = row_list_spec("anime:movies", today).unwrap();
        assert_eq!(movies.kind, "movie");
        assert!(movies.routes[0].starts_with("/discover/movie?with_genres=16&with_original_language=ja"));
        assert_eq!(anime_season_window("winter", 2027), ("2027-01-01".into(), "2027-03-31".into()));
    }

    #[test]
    fn catalog_rows_drop_japanese_animation_only() {
        let anime = json!({ "id": 1, "name": "Frieren", "poster_path": "/a.jpg", "genre_ids": [16, 10759], "original_language": "ja" });
        let pixar = json!({ "id": 2, "title": "Coco", "poster_path": "/a.jpg", "genre_ids": [16, 10751], "original_language": "en" });
        let ja_live = json!({ "id": 3, "title": "Shogun", "poster_path": "/a.jpg", "genre_ids": [18], "original_language": "ja" });
        let no_poster = json!({ "id": 4, "title": "X", "genre_ids": [18], "original_language": "en" });
        assert!(is_japanese_animation(&anime));
        assert!(!row_candidate_ok(&anime, true));
        assert!(row_candidate_ok(&anime, false));
        assert!(row_candidate_ok(&pixar, true));
        assert!(row_candidate_ok(&ja_live, true));
        assert!(!row_candidate_ok(&no_poster, false));
        let detail_style = json!({ "genres": [{ "id": 16, "name": "Animación" }], "original_language": "ja" });
        assert!(is_japanese_animation(&detail_style));
    }

    #[test]
    fn detail_maps_movie_credits_and_tv_seasons() {
        let movie = json!({
            "id": 354912, "title": "Coco", "original_title": "Coco", "release_date": "2017-10-27",
            "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "vote_average": 8.2, "overview": "Miguel",
            "runtime": 105, "genres": [{ "id": 16, "name": "Animación" }, { "id": 10751, "name": "Familia" }],
            "credits": {
                "cast": [{ "name": "Anthony Gonzalez" }, { "name": "Gael García Bernal" }, { "name": "A" }, { "name": "B" },
                         { "name": "C" }, { "name": "D" }, { "name": "E" }, { "name": "F" }, { "name": "G" }],
                "crew": [{ "name": "Lee Unkrich", "job": "Director" }, { "name": "Adrian Molina", "job": "Co-Director" },
                         { "name": "Lee Unkrich", "job": "Director" }, { "name": "Darla K. Anderson", "job": "Producer" }]
            },
            "recommendations": { "results": [
                { "id": 1, "media_type": "movie", "title": "Up", "poster_path": "/u.jpg", "release_date": "2009-05-29" },
                { "id": 2, "media_type": "person", "name": "Someone", "poster_path": "/x.jpg" },
                { "id": 3, "media_type": "movie", "title": "Sin poster" }
            ] },
            "similar": { "results": [
                { "id": 1, "title": "Up", "poster_path": "/u.jpg", "release_date": "2009-05-29" },
                { "id": 4, "title": "Encanto", "poster_path": "/e.jpg", "release_date": "2021-11-24" }
            ] }
        });
        let d = detail_from("movie", "tt2380307", &movie);
        assert_eq!(d["tmdbId"], 354912);
        assert_eq!(d["item"]["imdbId"], "tt2380307");
        assert_eq!(d["item"]["runtime"], 105);
        assert_eq!(d["item"]["genres"], json!(["Animation", "Family"]));
        assert_eq!(d["item"]["backdrop"], "https://image.tmdb.org/t/p/w1280/b.jpg");
        assert_eq!(d["director"], json!(["Lee Unkrich"]));
        assert_eq!(d["cast"].as_array().unwrap().len(), 8);
        assert_eq!(d["cast"][1], "Gael García Bernal");
        assert_eq!(d["seasons"], json!([]));
        let rel = related_candidates("movie", &movie, 12);
        let ids: Vec<u64> = rel.iter().map(|r| r["id"].as_u64().unwrap()).collect();
        assert_eq!(ids, vec![1, 4]);

        let tv = json!({
            "id": 1399, "name": "Juego de tronos", "first_air_date": "2011-04-17", "poster_path": "/g.jpg",
            "episode_run_time": [], "last_episode_to_air": { "runtime": 80 },
            "created_by": [{ "name": "David Benioff" }, { "name": "D. B. Weiss" }],
            "credits": { "cast": [{ "name": "Emilia Clarke" }], "crew": [{ "name": "X", "job": "Director" }] },
            "seasons": [{ "season_number": 2 }, { "season_number": 0 }, { "season_number": 1 }, { "season_number": 2 }]
        });
        let d = detail_from("tv", "tt0944947", &tv);
        assert_eq!(d["item"]["kind"], "tv");
        assert_eq!(d["item"]["year"], "2011");
        assert_eq!(d["item"]["runtime"], 80);
        assert_eq!(d["director"], json!(["David Benioff", "D. B. Weiss"]));
        assert_eq!(d["cast"], json!(["Emilia Clarke"]));
        assert_eq!(d["seasons"], json!([1, 2]));
    }

    #[test]
    fn episodes_name_and_mapping() {
        assert_eq!(parse_episodes_name("1399:2"), Some((1399, 2)));
        assert_eq!(parse_episodes_name("1399:0"), Some((1399, 0)));
        assert_eq!(parse_episodes_name("1399"), None);
        assert_eq!(parse_episodes_name("13a9:2"), None);
        assert_eq!(parse_episodes_name("1399:-1"), None);
        assert_eq!(parse_episodes_name("1399:2:3"), None);
        let data = json!({ "episodes": [
            { "episode_number": 1, "season_number": 2, "name": "El norte no olvida", "overview": "Resumen",
              "still_path": "/s.jpg", "air_date": "2012-04-01", "runtime": 53 },
            { "episode_number": 2, "name": "Sin datos", "still_path": null, "runtime": null },
            { "name": "Sin numero" }
        ] });
        let eps = map_episodes(2, &data);
        assert_eq!(eps.len(), 2);
        assert_eq!(eps[0], json!({ "season": 2, "number": 1, "title": "El norte no olvida", "overview": "Resumen",
            "still": "https://image.tmdb.org/t/p/w300/s.jpg", "airDate": "2012-04-01", "runtime": 53 }));
        assert_eq!(eps[1]["season"], 2);
        assert_eq!(eps[1]["still"], "");
        assert_eq!(eps[1]["runtime"], 0);
    }
}
