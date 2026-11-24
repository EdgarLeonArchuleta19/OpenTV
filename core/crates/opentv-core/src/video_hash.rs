use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{HeaderValue, RANGE};
use serde::Serialize;
use tokio::sync::RwLock;

use crate::dnsx::Dnsx;
use crate::safe_http::{fetch_url, header_map_from, FetchOptions};

const CHUNK_SIZE: usize = 65_536;

#[derive(Clone, Debug, Serialize)]
pub struct VideoHashResult {
    pub hash: String,
    pub size: u64,
}

#[derive(Clone)]
pub struct VideoHasher {
    dns: Dnsx,
    cache: Arc<RwLock<HashMap<String, VideoHashResult>>>,
}

/// Computes the exact OpenSubtitles 64-bit hash:
/// `size + sum(first 64 KB as little-endian u64) + sum(last 64 KB as little-endian u64)`.
pub fn compute_opensubtitles_hash(head: &[u8], tail: &[u8], size: u64) -> String {
    let mut hash: u64 = size;
    for chunk in head.chunks_exact(8) {
        let word = u64::from_le_bytes(chunk.try_into().unwrap());
        hash = hash.wrapping_add(word);
    }
    for chunk in tail.chunks_exact(8) {
        let word = u64::from_le_bytes(chunk.try_into().unwrap());
        hash = hash.wrapping_add(word);
    }
    format!("{hash:016x}")
}

impl VideoHasher {
    pub fn new(dns: Dnsx) -> Self {
        Self {
            dns,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn hash_url(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        allow_lan: bool,
    ) -> Result<VideoHashResult, String> {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("Sin enlace".to_string());
        }
        // LAN access is part of the identity: a cached public fetch must never
        // be reused to answer a request that is allowed (or denied) differently.
        let cache_key = format!("{allow_lan}:{url}");
        if let Some(hit) = self.cache.read().await.get(&cache_key) {
            return Ok(hit.clone());
        }

        let (head, total) = self
            .fetch_range(url, headers, &format!("bytes=0-{}", CHUNK_SIZE - 1), allow_lan)
            .await?;
        if total < (CHUNK_SIZE as u64) * 2 {
            return Err("archivo demasiado pequeño".to_string());
        }
        let tail_range = format!("bytes={}-{}", total - CHUNK_SIZE as u64, total - 1);
        let (tail, _) = self.fetch_range(url, headers, &tail_range, allow_lan).await?;
        if head.len() < CHUNK_SIZE || tail.len() < CHUNK_SIZE {
            return Err("lectura incompleta".to_string());
        }

        let res = VideoHashResult {
            hash: compute_opensubtitles_hash(&head[..CHUNK_SIZE], &tail[..CHUNK_SIZE], total),
            size: total,
        };
        let mut guard = self.cache.write().await;
        if guard.len() > 256 {
            guard.clear();
        }
        guard.insert(cache_key, res.clone());
        Ok(res)
    }

    async fn fetch_range(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        range: &str,
        allow_lan: bool,
    ) -> Result<(Vec<u8>, u64), String> {
        let mut hmap = header_map_from(headers);
        hmap.insert(RANGE, HeaderValue::from_str(range).map_err(|e| e.to_string())?);

        let mut opts = FetchOptions::new(&self.dns, allow_lan, Duration::from_secs(15));
        opts.headers = hmap;
        let resp = fetch_url(url, opts).await?;

        if resp.status().as_u16() != 206 {
            return Err(format!("sin Range ({})", resp.status().as_u16()));
        }

        let total = resp
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.rsplit('/').next())
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(0);

        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        Ok((bytes.to_vec(), total))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_opensubtitles_64bit_le_sum() {
        let mut head = vec![0u8; CHUNK_SIZE];
        let mut tail = vec![0u8; CHUNK_SIZE];
        head[0..8].copy_from_slice(&1u64.to_le_bytes());
        tail[0..8].copy_from_slice(&2u64.to_le_bytes());
        let h = compute_opensubtitles_hash(&head, &tail, 131_072);
        // 131072 + 1 + 2 = 131075 = 0x20003
        assert_eq!(h, "0000000000020003");
    }
}
