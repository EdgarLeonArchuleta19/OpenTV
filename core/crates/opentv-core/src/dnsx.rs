use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::RwLock;

const CACHE_TTL: Duration = Duration::from_secs(300);
const MAX_CACHE_ENTRIES: usize = 256;

#[derive(Clone, Debug)]
struct DnsEntry {
    ips: Vec<IpAddr>,
    source: &'static str,
    at: Instant,
}

/// DNS resolver with system lookup + automatic DoH fallback (Cloudflare / Google),
/// mirroring `service/dnsx.js` and `Dnsx.java`.
#[derive(Clone)]
pub struct Dnsx {
    client: reqwest::Client,
    cache: Arc<RwLock<HashMap<String, DnsEntry>>>,
}

#[derive(Deserialize)]
struct DohResponse {
    #[serde(rename = "Answer")]
    answer: Option<Vec<DohAnswer>>,
}

#[derive(Deserialize)]
struct DohAnswer {
    #[serde(rename = "type")]
    rtype: u16,
    data: String,
}

impl Dnsx {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .user_agent("OpenTV/2.0")
            .build()
            .expect("reqwest client");
        Self {
            client,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn resolve(&self, hostname: &str) -> Result<Vec<IpAddr>, String> {
        let host = hostname
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_ascii_lowercase();
        if host.is_empty() {
            return Err("Host vacío".to_string());
        }
        if let Ok(ip) = host.parse::<IpAddr>() {
            return Ok(vec![ip]);
        }

        // Cache hit
        {
            let guard = self.cache.read().await;
            if let Some(entry) = guard.get(&host) {
                if entry.at.elapsed() < CACHE_TTL && !entry.ips.is_empty() {
                    return Ok(entry.ips.clone());
                }
            }
        }

        // 1) System DNS lookup (fast path)
        if let Ok(Ok(addrs)) =
            tokio::time::timeout(Duration::from_secs(4), tokio::net::lookup_host((host.as_str(), 80)))
                .await
        {
            let mut ips: Vec<IpAddr> = Vec::new();
            for addr in addrs {
                let ip = addr.ip();
                if !ips.contains(&ip) {
                    ips.push(ip);
                }
            }
            if !ips.is_empty() {
                // IPv4 first: many TV/home networks hand out a global IPv6 address with no
                // working IPv6 route (seen on Fire TV), and callers pin to the first address.
                ips.sort_by_key(|ip| if ip.is_ipv4() { 0 } else { 1 });
                self.put_cache(&host, ips.clone(), "system").await;
                return Ok(ips);
            }
        }

        // 2) DoH fallback (Cloudflare, then Google) for blocked/broken ISP/TV DNS
        for (source, url) in [
            (
                "doh-cf",
                format!("https://1.1.1.1/dns-query?name={host}&type=A"),
            ),
            (
                "doh-google",
                format!("https://8.8.8.8/resolve?name={host}&type=A"),
            ),
        ] {
            if let Ok(ips) = self.query_doh(&url).await {
                if !ips.is_empty() {
                    self.put_cache(&host, ips.clone(), source).await;
                    return Ok(ips);
                }
            }
        }

        Err(format!("No se pudo resolver {host}"))
    }

    async fn query_doh(&self, url: &str) -> Result<Vec<IpAddr>, String> {
        let resp = self
            .client
            .get(url)
            .header("Accept", "application/dns-json")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("DoH HTTP {}", resp.status()));
        }
        let body: DohResponse = resp.json().await.map_err(|e| e.to_string())?;
        let mut ips = Vec::new();
        for ans in body.answer.unwrap_or_default() {
            // A (1) or AAAA (28)
            if (ans.rtype == 1 || ans.rtype == 28) && ans.data.parse::<IpAddr>().is_ok() {
                let ip: IpAddr = ans.data.parse().unwrap();
                if !ips.contains(&ip) {
                    ips.push(ip);
                }
            }
        }
        Ok(ips)
    }

    async fn put_cache(&self, host: &str, ips: Vec<IpAddr>, source: &'static str) {
        let mut guard = self.cache.write().await;
        if guard.len() >= MAX_CACHE_ENTRIES {
            guard.clear();
        }
        guard.insert(
            host.to_string(),
            DnsEntry {
                ips,
                source,
                at: Instant::now(),
            },
        );
    }

    pub async fn summary(&self) -> Vec<Value> {
        let guard = self.cache.read().await;
        guard
            .iter()
            .map(|(host, entry)| {
                json!({
                    "host": host,
                    "source": entry.source,
                    "ips": entry.ips.iter().map(|ip| ip.to_string()).collect::<Vec<_>>(),
                    "ageMs": entry.at.elapsed().as_millis() as u64,
                })
            })
            .collect()
    }
}
