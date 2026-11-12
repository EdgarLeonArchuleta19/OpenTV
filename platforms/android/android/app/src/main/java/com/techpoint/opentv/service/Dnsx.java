package com.techpoint.opentv.service;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/*
 * DNS-over-HTTPS, port of service/dnsx.js.
 *
 * Some carriers block the portal and CDN hostnames by poisoning DNS. The A
 * record is asked to several public resolvers over HTTPS (addressed by IP);
 * the first answer wins. Only the TCP address changes: TLS SNI and Host keep
 * the hostname (see Http). When every resolver fails, the system resolver is
 * used and DoH rests for five minutes.
 */
final class Dnsx {
    private Dnsx() {}

    static final class Result {
        final String host;
        final List<String> ips;
        final String source;
        final long at;
        final long ttl;

        Result(String host, List<String> ips, String source, long at, long ttl) {
            this.host = host; this.ips = ips; this.source = source; this.at = at; this.ttl = ttl;
        }
    }

    private static final long CACHE_MS = 10 * 60 * 1000;
    private static final long SYSTEM_CACHE_MS = 60 * 1000;
    private static final int DOH_TIMEOUT = 5000;
    private static final long DOH_DOWN_MS = 5 * 60 * 1000;

    private static final String[][] PROVIDERS = {
        {"1.1.1.1", "cloudflare-dns.com", "/dns-query"},
        {"1.0.0.1", "cloudflare-dns.com", "/dns-query"},
        {"1.1.1.2", "security.cloudflare-dns.com", "/dns-query"},
        {"1.0.0.2", "security.cloudflare-dns.com", "/dns-query"},
        {"8.8.8.8", "dns.google", "/resolve"},
        {"8.8.4.4", "dns.google", "/resolve"},
        {"94.140.14.14", "dns.adguard-dns.com", "/resolve"},
        {"94.140.15.15", "dns.adguard-dns.com", "/resolve"},
        {"94.140.14.140", "unfiltered.adguard-dns.com", "/resolve"},
        {"94.140.14.141", "unfiltered.adguard-dns.com", "/resolve"},
        {"223.5.5.5", "dns.alidns.com", "/resolve"},
        {"223.6.6.6", "dns.alidns.com", "/resolve"},
        {"185.222.222.222", "doh.dns.sb", "/dns-query"},
        {"45.11.45.11", "doh.dns.sb", "/dns-query"},
        {"45.90.28.0", "dns.nextdns.io", "/dns-query"},
        {"45.90.30.0", "dns.nextdns.io", "/dns-query"}
    };

    private static final Map<String, Result> cache = new ConcurrentHashMap<>();
    private static final Map<String, Integer> dialIndex = new ConcurrentHashMap<>();
    private static volatile long dohDownUntil = 0;
    private static final ExecutorService pool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "opentv-dns");
        t.setDaemon(true);
        return t;
    });

    private static final Pattern IPV4 = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}$");

    static boolean isIpv4(String host) {
        return host != null && IPV4.matcher(host).matches();
    }

    static Result cached(String host) {
        Result hit = host == null ? null : cache.get(host);
        if (hit == null) return null;
        if (System.currentTimeMillis() - hit.at > hit.ttl) return null;
        return hit;
    }

    private static Result keep(String host, List<String> ips, String source, long ttl) {
        List<String> uniq = new ArrayList<>();
        for (String ip : ips) if (ip != null && !uniq.contains(ip)) uniq.add(ip);
        Result r = new Result(host, uniq, source, System.currentTimeMillis(), ttl);
        cache.put(host, r);
        return r;
    }

    /* Round robin over the addresses of one host, like dnsx.dial. */
    static String dial(String host, List<String> ips) {
        if (ips == null || ips.isEmpty()) return "";
        if (ips.size() == 1) return ips.get(0);
        synchronized (dialIndex) {
            Integer cur = dialIndex.get(host);
            int next = ((cur == null ? 0 : cur) + 1) % ips.size();
            dialIndex.put(host, next);
            return ips.get(next);
        }
    }

    /* resolve(host) -> addresses; throws when neither DoH nor the system answers. */
    static Result resolve(String host) throws IOException {
        if (host == null || host.isEmpty()) throw new IOException("host vacio");
        if (isIpv4(host)) {
            List<String> one = new ArrayList<>();
            one.add(host);
            return new Result(host, one, "ip", System.currentTimeMillis(), 0);
        }
        Result hit = cached(host);
        if (hit != null) return hit;
        IOException dohError;
        try {
            List<String> ips = queryDoh(host);
            if (!ips.isEmpty()) return keep(host, ips, "doh", CACHE_MS);
            dohError = new IOException("DoH sin respuesta");
        } catch (IOException e) {
            dohError = e;
        }
        try {
            return keep(host, systemLookup(host), "system", SYSTEM_CACHE_MS);
        } catch (IOException e) {
            throw dohError;
        }
    }

    /* The resolved IP to dial for a hostname ("" when nothing answered). */
    static String prepare(String host) throws IOException {
        if (isIpv4(host)) return host;
        Result r = resolve(host);
        return dial(host, r.ips);
    }

    private static List<String> systemLookup(final String host) throws IOException {
        Future<List<String>> f = pool.submit(() -> {
            List<String> out = new ArrayList<>();
            for (InetAddress a : InetAddress.getAllByName(host)) {
                if (a instanceof Inet4Address) out.add(a.getHostAddress());
            }
            return out;
        });
        try {
            List<String> ips = f.get(2500, TimeUnit.MILLISECONDS);
            if (ips.isEmpty()) throw new IOException("DNS del televisor: sin respuesta");
            return ips;
        } catch (java.util.concurrent.TimeoutException e) {
            f.cancel(true);
            throw new IOException("DNS del televisor: tiempo agotado");
        } catch (java.util.concurrent.ExecutionException e) {
            throw new IOException(e.getCause() != null ? e.getCause().getMessage() : "DNS del televisor: error");
        } catch (InterruptedException e) {
            throw new IOException("interrumpido");
        }
    }

    /* Every provider at once; the first list of A records wins and the rest
       are cancelled. */
    private static List<String> queryDoh(String host) throws IOException {
        if (System.currentTimeMillis() < dohDownUntil) throw new IOException("DoH no disponible en esta red");
        final LinkedBlockingQueue<Object> results = new LinkedBlockingQueue<>();
        final List<Http.Call> calls = new ArrayList<>();
        String name;
        try {
            name = URLEncoder.encode(host, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            name = host;
        }
        for (final String[] p : PROVIDERS) {
            final Http.Call call = new Http.Call();
            calls.add(call);
            final String path = p[2] + "?name=" + name + "&type=A";
            pool.execute(() -> {
                try {
                    results.add(dohQuery(call, p, path));
                } catch (Exception e) {
                    results.add(new IOException("DoH " + p[0] + ": " + e.getMessage()));
                }
            });
        }
        List<String> errors = new ArrayList<>();
        long deadline = System.currentTimeMillis() + DOH_TIMEOUT * 2 + 1000;
        try {
            for (int got = 0; got < PROVIDERS.length; got++) {
                long left = deadline - System.currentTimeMillis();
                Object r = left > 0 ? results.poll(left, TimeUnit.MILLISECONDS) : null;
                if (r == null) { errors.add("tiempo agotado"); break; }
                if (r instanceof List) {
                    dohDownUntil = 0;
                    @SuppressWarnings("unchecked") List<String> ips = (List<String>) r;
                    return ips;
                }
                errors.add(((Exception) r).getMessage());
            }
        } catch (InterruptedException e) {
            errors.add("interrumpido");
        } finally {
            for (Http.Call c : calls) c.cancel();
        }
        dohDownUntil = System.currentTimeMillis() + DOH_DOWN_MS;
        throw new IOException(android.text.TextUtils.join(" | ", errors));
    }

    private static List<String> dohQuery(Http.Call call, String[] p, String path) throws Exception {
        Http.Request r = new Http.Request();
        r.secure = true;
        r.connectHost = p[0];
        r.port = 443;
        r.tlsName = p[1];
        r.path = path;
        r.connectTimeout = DOH_TIMEOUT;
        r.readTimeout = DOH_TIMEOUT;
        r.headers.put("accept", "application/dns-json");
        r.headers.put("host", p[1]);
        r.headers.put("User-Agent", "OpenTV/Android");
        Http.Response res = call.execute(r);
        try {
            if (res.status != 200) throw new IOException("HTTP " + res.status);
            byte[] raw = res.readAll(1 << 20);
            JSONObject answer = new JSONObject(new String(raw, Crypto.UTF8));
            JSONArray rows = answer.optJSONArray("Answer");
            List<String> ips = new ArrayList<>();
            for (int i = 0; rows != null && i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null && row.optInt("type") == 1 && isIpv4(row.optString("data"))) ips.add(row.optString("data"));
            }
            if (ips.isEmpty()) throw new IOException("sin registros A");
            return ips;
        } finally {
            res.close();
        }
    }
}
