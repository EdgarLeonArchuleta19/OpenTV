use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::dnsx::Dnsx;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpKind {
    Loopback,
    Lan,
    Blocked,
    Public,
}

/// Exact port of `service/netguard.js` and `NetGuard.java`.
/// - Loopback (127.0.0.0/8, ::1, localhost): never allowed.
/// - Home network (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, fc00::/7, fe80::/10):
///   only when `allow_lan` is true for that plugin.
/// - 0.0.0.0/8, multicast, unspecified, reserved: never allowed.
pub fn classify(ip: IpAddr) -> IpKind {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return classify_v4(mapped);
            }
            classify_v6(v6)
        }
    }
}

fn classify_v4(v4: Ipv4Addr) -> IpKind {
    let [a, b, _, _] = v4.octets();
    if a == 127 {
        return IpKind::Loopback;
    }
    if a == 0 || a >= 224 {
        return IpKind::Blocked;
    }
    if a == 10
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 169 && b == 254)
        || (a == 100 && (64..=127).contains(&b))
    {
        return IpKind::Lan;
    }
    IpKind::Public
}

fn classify_v6(v6: Ipv6Addr) -> IpKind {
    if v6.is_loopback() {
        return IpKind::Loopback;
    }
    if v6.is_unspecified() || v6.is_multicast() {
        return IpKind::Blocked;
    }
    let first = v6.segments()[0];
    // fc00::/7 (ULA) or fe80::/10 (link-local)
    if (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80 {
        return IpKind::Lan;
    }
    IpKind::Public
}

pub fn allowed(kind: IpKind, allow_lan: bool) -> bool {
    matches!(kind, IpKind::Public) || (matches!(kind, IpKind::Lan) && allow_lan)
}

pub fn classify_str(host: &str) -> Option<&'static str> {
    let clean = host
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if clean == "localhost" || clean.ends_with(".localhost") {
        return Some("loopback");
    }
    let ip = clean.parse::<IpAddr>().ok()?;
    Some(match classify(ip) {
        IpKind::Loopback => "loopback",
        IpKind::Lan => "lan",
        IpKind::Blocked => "blocked",
        IpKind::Public => "public",
    })
}

pub fn refusal_message(kind: IpKind) -> &'static str {
    match kind {
        IpKind::Lan => "Este plugin no tiene permiso para usar la red de tu casa",
        IpKind::Loopback => "No se permite conectar con el propio aparato",
        IpKind::Blocked => "Dirección no permitida",
        IpKind::Public => "",
    }
}

/// Resolves `hostname` and checks every returned IP against NetGuard rules.
/// Returns the first validated IP so the caller can pin the connection to it.
pub async fn check(dns: &Dnsx, hostname: &str, allow_lan: bool) -> Result<IpAddr, String> {
    check_all(dns, hostname, allow_lan).await.map(|ips| ips[0])
}

/// Every validated IP of `hostname`, IPv4 first, so a caller can fall back to the next
/// address when one is unreachable (e.g. a global IPv6 address without an IPv6 route).
pub async fn check_all(dns: &Dnsx, hostname: &str, allow_lan: bool) -> Result<Vec<IpAddr>, String> {
    let host = hostname
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if host.is_empty() {
        return Err("Host inválido".to_string());
    }
    if host == "localhost" || host.ends_with(".localhost") {
        return Err(refusal_message(IpKind::Loopback).to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        let kind = classify(ip);
        return if allowed(kind, allow_lan) {
            Ok(vec![ip])
        } else {
            Err(refusal_message(kind).to_string())
        };
    }

    let ips = dns.resolve(&host).await?;
    if ips.is_empty() {
        return Err(format!("No se pudo resolver {host}"));
    }
    // Every address of the hostname must pass (a mixed public + loopback answer is refused).
    for ip in &ips {
        let kind = classify(*ip);
        if !allowed(kind, allow_lan) {
            return Err(refusal_message(kind).to_string());
        }
    }
    let mut ips = ips;
    ips.sort_by_key(|ip| if ip.is_ipv4() { 0 } else { 1 });
    Ok(ips)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_all_ranges_like_js_and_java() {
        assert_eq!(classify("127.0.0.1".parse().unwrap()), IpKind::Loopback);
        assert_eq!(classify("127.42.0.1".parse().unwrap()), IpKind::Loopback);
        assert_eq!(classify("::1".parse().unwrap()), IpKind::Loopback);
        assert_eq!(classify("::ffff:127.0.0.1".parse().unwrap()), IpKind::Loopback);

        assert_eq!(classify("192.168.1.10".parse().unwrap()), IpKind::Lan);
        assert_eq!(classify("10.0.0.5".parse().unwrap()), IpKind::Lan);
        assert_eq!(classify("172.16.0.1".parse().unwrap()), IpKind::Lan);
        assert_eq!(classify("172.31.255.1".parse().unwrap()), IpKind::Lan);
        assert_eq!(classify("169.254.1.1".parse().unwrap()), IpKind::Lan);
        assert_eq!(classify("100.64.0.1".parse().unwrap()), IpKind::Lan);
        assert_eq!(classify("fd12::1".parse().unwrap()), IpKind::Lan);
        assert_eq!(classify("fe80::1".parse().unwrap()), IpKind::Lan);

        assert_eq!(classify("0.0.0.0".parse().unwrap()), IpKind::Blocked);
        assert_eq!(classify("224.0.0.1".parse().unwrap()), IpKind::Blocked);
        assert_eq!(classify("ff02::1".parse().unwrap()), IpKind::Blocked);

        assert_eq!(classify("1.1.1.1".parse().unwrap()), IpKind::Public);
        assert_eq!(classify("172.32.0.1".parse().unwrap()), IpKind::Public);
        assert_eq!(classify("2606:4700:4700::1111".parse().unwrap()), IpKind::Public);
    }

    #[test]
    fn enforces_allow_lan_policy() {
        assert!(!allowed(IpKind::Loopback, true));
        assert!(!allowed(IpKind::Blocked, true));
        assert!(!allowed(IpKind::Lan, false));
        assert!(allowed(IpKind::Lan, true));
        assert!(allowed(IpKind::Public, false));
    }
}
