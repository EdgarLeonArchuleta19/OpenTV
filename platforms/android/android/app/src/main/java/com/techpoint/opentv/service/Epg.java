package com.techpoint.opentv.service;

import android.util.Log;
import android.util.Xml;

import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.io.BufferedInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/*
 * TV en vivo: the programme guide of an M3U list (port of service/epg.js).
 * The list's header names an XMLTV file (#EXTM3U url-tvg="…", often .xml.gz,
 * up to ~8 MB of text). It is read as a stream with the platform's pull
 * parser (no DOM: a 1 GB Fire TV never holds the whole file), keeping per
 * channel only the programmes of the next 12 hours with a short title and
 * description.
 *
 *   get(url, ids) -> { id: [ { s, e, t, d }, … ] }   (now and the next two)
 *
 * One copy per guide link, kept for TTL_MS (a failed one for FAIL_TTL_MS).
 */
final class Epg {
    private Epg() {}

    private static final long TTL_MS = 6 * 60 * 60 * 1000L;
    private static final long FAIL_TTL_MS = 10 * 60 * 1000L;
    private static final long AHEAD_MS = 12 * 60 * 60 * 1000L;
    private static final int PER_CHANNEL = 10;
    private static final int ANSWER_PER_CHANNEL = 3;
    private static final int MAX_IDS = 4000;
    private static final long MAX_BYTES = 80L * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final int TITLE_MAX = 120;
    private static final int DESC_MAX = 220;
    private static final String TOO_BIG = "La guía es demasiado grande";
    private static final Pattern HTTP_URL = Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE);
    private static final Pattern TIME = Pattern.compile("^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})?\\s*([+-])?(\\d{2})?(\\d{2})?");

    private static final class Prog {
        final long s, e;
        final String t, d;
        Prog(long s, long e, String t, String d) { this.s = s; this.e = e; this.t = t; this.d = d; }
    }

    private static final class Guide {
        long at;
        String failed;
        Map<String, List<Prog>> byId = new HashMap<>();
    }

    private static final Map<String, Guide> guides = new HashMap<>();
    // One download per link at a time; other callers wait for it.
    private static final Map<String, Object> locks = new HashMap<>();

    static JSONObject get(String url, Object idsValue) throws Exception {
        if (url == null || url.isEmpty()) throw new PortalException("url requerida");
        Guide g = load(url);
        if (g.failed != null) throw new PortalException(g.failed);
        long now = System.currentTimeMillis();
        JSONObject out = new JSONObject();
        JSONArray ids = Js.arr(idsValue);
        for (int i = 0; ids != null && i < ids.length() && i < MAX_IDS; i++) {
            String id = Js.text(ids.opt(i));
            List<Prog> list = g.byId.get(id);
            if (list == null) continue;
            JSONArray shown = new JSONArray();
            for (Prog p : list) {
                if (shown.length() >= ANSWER_PER_CHANNEL) break;
                if (p.e <= now) continue;
                JSONObject o = Js.o("s", p.s, "e", p.e, "t", p.t);
                if (!p.d.isEmpty()) Js.put(o, "d", p.d);
                shown.put(o);
            }
            if (shown.length() > 0) out.put(id, shown);
        }
        return out;
    }

    private static Guide load(String url) {
        Object lock;
        synchronized (locks) {
            lock = locks.get(url);
            if (lock == null) { lock = new Object(); locks.put(url, lock); }
        }
        synchronized (lock) {
            Guide g;
            synchronized (guides) { g = guides.get(url); }
            long now = System.currentTimeMillis();
            if (g != null && now - g.at < (g.failed != null ? FAIL_TTL_MS : TTL_MS)) return g;
            Guide fresh = new Guide();
            try {
                download(url, fresh.byId);
            } catch (PortalException e) {
                fresh.failed = e.getMessage();
                fresh.byId = new HashMap<>();
            } catch (Throwable t) {
                fresh.failed = TOO_BIG.equals(t.getMessage()) ? TOO_BIG : "No se pudo leer la guía";
                fresh.byId = new HashMap<>();
            }
            fresh.at = System.currentTimeMillis();
            synchronized (guides) { guides.put(url, fresh); }
            return fresh;
        }
    }

    private static void download(String urlStr, Map<String, List<Prog>> byId) throws Exception {
        for (int redirects = 0; ; redirects++) {
            if (!HTTP_URL.matcher(urlStr).find()) throw new PortalException("La guía debe ser una dirección http(s)");
            if (redirects > MAX_REDIRECTS) throw new PortalException("Demasiadas redirecciones al descargar la guía");
            Http.Url u = Http.Url.parse(urlStr);
            boolean secure = urlStr.regionMatches(true, 0, "https://", 0, 8);
            int port = u.port.isEmpty() ? (secure ? 443 : 80) : Integer.parseInt(u.port);
            Http.Request r = new Http.Request();
            r.secure = secure;
            r.connectHost = Dnsx.prepare(u.hostname);
            r.port = port;
            r.tlsName = u.hostname;
            r.path = u.path;
            r.connectTimeout = 20000;
            r.readTimeout = 30000;
            r.headers.put("User-Agent", "Mozilla/5.0 (OpenTV)");
            r.headers.put("Host", u.hostname + (port != (secure ? 443 : 80) ? ":" + port : ""));
            Http.Response res;
            try {
                res = Http.execute(r);
            } catch (java.net.SocketTimeoutException e) {
                throw new PortalException("Tiempo de espera agotado al descargar la guía");
            }
            try {
                if (res.status >= 300 && res.status < 400 && res.header("location") != null) {
                    urlStr = Http.Url.resolve(urlStr, res.header("location"));
                    continue;
                }
                if (res.status != 200) throw new PortalException("HTTP " + res.status + " al descargar la guía");
                parse(res.body, byId);
                return;
            } finally {
                res.abort();
            }
        }
    }

    /* Counts what is read, so a huge file stops at MAX_BYTES. */
    private static final class Capped extends FilterInputStream {
        long read;
        Capped(InputStream in) { super(in); }
        private void add(long n) throws IOException {
            if (n > 0 && (read += n) > MAX_BYTES) throw new IOException(TOO_BIG);
        }
        @Override public int read() throws IOException { int b = super.read(); if (b >= 0) add(1); return b; }
        @Override public int read(byte[] b, int off, int len) throws IOException { int n = super.read(b, off, len); add(n); return n; }
    }

    private static void parse(InputStream raw, Map<String, List<Prog>> byId) throws Exception {
        BufferedInputStream in = new BufferedInputStream(raw, 64 * 1024);
        in.mark(2);
        int b0 = in.read(), b1 = in.read();
        in.reset();
        InputStream text = new Capped(b0 == 0x1f && b1 == 0x8b ? new GZIPInputStream(in, 64 * 1024) : in);
        XmlPullParser xp = Xml.newPullParser();
        xp.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false);
        xp.setInput(text, null);
        long now = System.currentTimeMillis();
        long until = now + AHEAD_MS;
        String channel = null;
        long s = 0, e = 0;
        String title = null, desc = null;
        boolean keep = false;
        int seen = 0, kept = 0;
        for (int ev = xp.getEventType(); ev != XmlPullParser.END_DOCUMENT; ev = xp.next()) {
            if (ev == XmlPullParser.START_TAG) {
                String name = xp.getName();
                if ("programme".equals(name)) {
                    seen++;
                    channel = xp.getAttributeValue(null, "channel");
                    s = xmltvTime(xp.getAttributeValue(null, "start"));
                    e = xmltvTime(xp.getAttributeValue(null, "stop"));
                    title = null;
                    desc = null;
                    List<Prog> have = channel == null ? null : byId.get(channel);
                    keep = channel != null && s > 0 && e > now && s < until && (have == null || have.size() < PER_CHANNEL * 2);
                } else if (keep && title == null && "title".equals(name)) {
                    title = clean(xp.nextText(), TITLE_MAX);
                } else if (keep && desc == null && "desc".equals(name)) {
                    desc = clean(xp.nextText(), DESC_MAX);
                }
            } else if (ev == XmlPullParser.END_TAG && "programme".equals(xp.getName())) {
                if (keep) {
                    List<Prog> list = byId.get(channel);
                    if (list == null) { list = new ArrayList<>(); byId.put(channel, list); }
                    list.add(new Prog(s, e, title == null || title.isEmpty() ? "Programa" : title, desc == null ? "" : desc));
                    kept++;
                }
                keep = false;
            }
        }
        Log.i("OpenTV", "epg: " + seen + " programas leídos, " + kept + " guardados de " + byId.size() + " canales");
        for (Map.Entry<String, List<Prog>> en : byId.entrySet()) {
            List<Prog> list = en.getValue();
            Collections.sort(list, (x, y) -> Long.compare(x.s, y.s));
            if (list.size() > PER_CHANNEL) en.setValue(new ArrayList<>(list.subList(0, PER_CHANNEL)));
        }
    }

    private static String clean(String s, int max) {
        String t = (s == null ? "" : s).replaceAll("\\s+", " ").trim();
        if (t.length() <= max) return t;
        String cut = t.substring(0, max - 1);
        int sp = cut.lastIndexOf(' ');
        return (sp > max / 2 ? cut.substring(0, sp) : cut) + "…";
    }

    /* "20261119050428 +0000" -> ms. */
    static long xmltvTime(String text) {
        if (text == null) return 0;
        Matcher m = TIME.matcher(text.trim());
        if (!m.find()) return 0;
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)) - 1, Integer.parseInt(m.group(3)),
            Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)), m.group(6) == null ? 0 : Integer.parseInt(m.group(6)));
        long t = c.getTimeInMillis();
        if (m.group(7) != null && m.group(8) != null) {
            int mins = Integer.parseInt(m.group(8)) * 60 + (m.group(9) == null ? 0 : Integer.parseInt(m.group(9)));
            t -= ("-".equals(m.group(7)) ? -1 : 1) * mins * 60000L;
        }
        return t;
    }
}
