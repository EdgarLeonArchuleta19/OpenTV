use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::RwLock;

const BASE: &str = "https://www.subtitlecat.com";

#[derive(Clone, Debug, Serialize)]
pub struct SubtitleCatHit {
    pub lang: String,
    pub url: String,
}

#[derive(Clone)]
pub struct SubtitleCat {
    client: reqwest::Client,
    title_cache: Arc<RwLock<HashMap<String, String>>>,
}

fn re_search_link() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"<a href="(subs/\d+/[^"]+\.html)">([^<]{1,300})</a>"#).unwrap()
    })
}

fn re_srt_link() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"href="(/subs/\d+/[^"]+\.srt)""#).unwrap())
}

impl SubtitleCat {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            title_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn search(&self, params: &Value) -> Vec<SubtitleCatHit> {
        let imdb_id = params["imdbId"].as_str().unwrap_or("");
        let kind = params["kind"].as_str().unwrap_or("movie");
        let mut title = params["title"].as_str().unwrap_or("").trim().to_string();
        let year = params["year"].as_str().unwrap_or("").trim();
        let season = params["season"].as_u64().unwrap_or(0);
        let episode = params["episode"].as_u64().unwrap_or(0);

        if let Some(orig) = self.original_title(imdb_id, kind).await {
            title = orig;
        }
        if title.is_empty() {
            return Vec::new();
        }

        let query = if kind == "series" && season > 0 && episode > 0 {
            format!("{title} S{season:02}E{episode:02}")
        } else if year.len() == 4 && year.chars().all(|c| c.is_ascii_digit()) {
            format!("{title} {year}")
        } else {
            title
        };

        let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
        let search_url = format!("{BASE}/index.php?search={encoded}");
        let html = match self.get_text(&search_url, 4500).await {
            Ok(t) => t,
            Err(_) => return Vec::new(),
        };

        let pages: Vec<String> = re_search_link()
            .captures_iter(&html)
            .filter_map(|c| c.get(1).map(|m| m.as_str().to_string()))
            .take(2)
            .collect();

        let mut out = Vec::new();
        let mut es_count = 0usize;
        let mut en_count = 0usize;

        for rel_path in pages {
            let page_url = format!("{BASE}/{rel_path}");
            let Ok(page_html) = self.get_text(&page_url, 4500).await else {
                continue;
            };
            for cap in re_srt_link().captures_iter(&page_html) {
                let Some(path) = cap.get(1).map(|m| m.as_str()) else {
                    continue;
                };
                let low = path.to_ascii_lowercase();
                let lang = if low.ends_with("-es.srt") || low.contains("spanish") {
                    if es_count >= 3 {
                        continue;
                    }
                    es_count += 1;
                    "spa"
                } else if low.ends_with("-en.srt") || low.ends_with("-orig.srt") {
                    if en_count >= 3 {
                        continue;
                    }
                    en_count += 1;
                    "eng"
                } else {
                    continue;
                };
                out.push(SubtitleCatHit {
                    lang: lang.to_string(),
                    url: format!("{BASE}{path}"),
                });
            }
        }
        out
    }

    async fn original_title(&self, imdb_id: &str, kind: &str) -> Option<String> {
        let clean = imdb_id.split(':').next().unwrap_or("");
        if !clean.starts_with("tt") || clean.len() < 7 {
            return None;
        }
        if let Some(hit) = self.title_cache.read().await.get(clean) {
            return Some(hit.clone());
        }
        let media_type = if kind == "series" { "series" } else { "movie" };
        let url = format!("https://v3-cinemeta.strem.io/meta/{media_type}/{clean}.json");
        let text = self.get_text(&url, 2500).await.ok()?;
        let json: Value = serde_json::from_str(&text).ok()?;
        let name = json["meta"]["name"].as_str()?.trim().to_string();
        if name.is_empty() {
            return None;
        }
        self.title_cache
            .write()
            .await
            .insert(clean.to_string(), name.clone());
        Some(name)
    }

    async fn get_text(&self, url: &str, timeout_ms: u64) -> Result<String, String> {
        let resp = self
            .client
            .get(url)
            .timeout(Duration::from_millis(timeout_ms))
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status().as_u16()));
        }
        resp.text().await.map_err(|e| e.to_string())
    }
}
