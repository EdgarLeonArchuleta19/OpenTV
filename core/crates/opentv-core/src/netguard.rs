use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::dnsx::Dnsx;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpKind {
    Loopback,
    Lan,
    Blocked,
    Public,
}

/// Port of `service/netguard.js` and `NetGuard.java`, hardened.
/// - Loopback (127.0.0.0/8, ::1, localhost): never allowed.
/// - Home network (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, fc00::/7, fe80::/10):
///   only when `allow_lan` is true for that plugin.
/// - 0.0.0.0/8, multicast, unspecified, reserved, benchmarking (198.18/15), IETF protocol
///   assignments (192.0.0/24), documentation ranges and cloud metadata endpoints
///   (169.254.169.254, fd00:ec2::254): never allowed, even with `allow_lan`.
/// - IPv6 addresses that embed an IPv4 address (IPv4-mapped `::ffff:a.b.c.d`, IPv4-compatible
///   `::a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`) are classified by that IPv4 address.
pub fn classify(ip: IpAddr) -> IpKind {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(embedded) = embedded_ipv4(v6) {
                return classify_v4(embedded);
            }
            classify_v6(v6)
        }
    }
}

/// Extracts an IPv4 address tunnelled inside an IPv6 one, so `64:ff9b::7f00:1` or
/// `2002:c0a8:0101::` cannot be used to reach loopback / the home network.
fn embedded_ipv4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(mapped) = v6.to_ipv4_mapped() {
        return Some(mapped);
    }
    let seg = v6.segments();
    let tail = Ipv4Addr::new(
        (seg[6] >> 8) as u8,
        (seg[6] & 0xff) as u8,
        (seg[7] >> 8) as u8,
        (seg[7] & 0xff) as u8,
    );
    // NAT64 well-known prefix 64:ff9b::/96.
    if seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2..6].iter().all(|s| *s == 0) {
        return Some(tail);
    }
    // 6to4 2002::/16 carries the IPv4 address in bits 16..48.
    if seg[0] == 0x2002 {
        return Some(Ipv4Addr::new(
            (seg[1] >> 8) as u8,
            (seg[1] & 0xff) as u8,
            (seg[2] >> 8) as u8,
            (seg[2] & 0xff) as u8,
        ));
    }
    // Deprecated IPv4-compatible ::a.b.c.d (excluding :: and ::1, handled as IPv6).
    if seg[..6].iter().all(|s| *s == 0) && !v6.is_unspecified() && !v6.is_loopback() {
        return Some(tail);
    }
    None
}

fn classify_v4(v4: Ipv4Addr) -> IpKind {
    let [a, b, c, d] = v4.octets();
    if a == 127 {
        return IpKind::Loopback;
    }
    if a == 0 || a >= 224 {
        return IpKind::Blocked;
    }
    // Cloud instance metadata endpoint: never reachable, not even with LAN permission.
    if [a, b, c, d] == [169, 254, 169, 254] {
        return IpKind::Blocked;
    }
    // 192.0.0.0/24 (IETF protocol assignments), 192.0.2.0/24, 198.51.100.0/24,
    // 203.0.113.0/24 (documentation) and 198.18.0.0/15 (benchmarking).
    if (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || (a == 198 && (b == 18 || b == 19))
    {
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
    let seg = v6.segments();
    let first = seg[0];
    // AWS IPv6 instance metadata endpoint fd00:ec2::254.
    if v6 == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254) {
        return IpKind::Blocked;
    }
    // 2001:db8::/32 (documentation), Teredo 2001::/32 (obfuscated embedded IPv4),
    // 64:ff9b:1::/48 (local-use NAT64) and the discard prefix 100::/64.
    if (first == 0x2001 && (seg[1] == 0x0db8 || seg[1] == 0))
        || (first == 0x0064 && seg[1] == 0xff9b && seg[2] == 0x0001)
        || (first == 0x0100 && seg[1..4].iter().all(|s| *s == 0))
    {
        return IpKind::Blocked;
    }
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

    fn kind(s: &str) -> IpKind {
        classify(s.parse().unwrap())
    }

    #[test]
    fn classifies_ipv4_embedded_in_ipv6_by_its_ipv4() {
        // NAT64 64:ff9b::/96
        assert_eq!(kind("64:ff9b::7f00:1"), IpKind::Loopback);
        assert_eq!(kind("64:ff9b::c0a8:101"), IpKind::Lan);
        assert_eq!(kind("64:ff9b::a9fe:a9fe"), IpKind::Blocked);
        assert_eq!(kind("64:ff9b::101:101"), IpKind::Public);
        // 6to4 2002::/16
        assert_eq!(kind("2002:7f00:1::"), IpKind::Loopback);
        assert_eq!(kind("2002:c0a8:101::1"), IpKind::Lan);
        assert_eq!(kind("2002:a00:1::"), IpKind::Lan);
        assert_eq!(kind("2002:808:808::1"), IpKind::Public);
        // IPv4-compatible ::a.b.c.d
        assert_eq!(kind("::127.0.0.1"), IpKind::Loopback);
        assert_eq!(kind("::192.168.0.1"), IpKind::Lan);
        assert_eq!(kind("::8.8.8.8"), IpKind::Public);
        // IPv4-mapped still works; :: and ::1 keep their IPv6 meaning.
        assert_eq!(kind("::ffff:10.0.0.1"), IpKind::Lan);
        assert_eq!(kind("::"), IpKind::Blocked);
        assert_eq!(kind("::1"), IpKind::Loopback);
    }

    #[test]
    fn blocks_special_purpose_and_metadata_ranges_even_with_lan() {
        for ip in [
            "169.254.169.254",
            "198.18.0.1",
            "198.19.255.254",
            "192.0.0.1",
            "192.0.0.170",
            "192.0.2.10",
            "198.51.100.7",
            "203.0.113.9",
            "255.255.255.255",
            "fd00:ec2::254",
            "2001:db8::1",
            "2001:0:4136:e378:8000:63bf:3fff:fdd2",
            "::ffff:169.254.169.254",
        ] {
            let k = kind(ip);
            assert_eq!(k, IpKind::Blocked, "{ip}");
            assert!(!allowed(k, true), "{ip}");
        }
        // The rest of link-local stays LAN-gated, and nearby public ranges stay public.
        assert_eq!(kind("169.254.1.1"), IpKind::Lan);
        assert_eq!(kind("198.20.0.1"), IpKind::Public);
        assert_eq!(kind("192.0.1.1"), IpKind::Public);
        assert_eq!(kind("2001:4860:4860::8888"), IpKind::Public);
    }
}
