use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::RwLock;

const CACHE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const ES_CACHE_MAX: usize = 500;
const SEARCH_CACHE_MAX: usize = 200;

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
