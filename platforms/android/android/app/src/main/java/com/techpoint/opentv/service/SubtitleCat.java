package com.techpoint.opentv.service;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Port of service/subtitlecat.js. Searches SubtitleCat (subtitlecat.com) for
 * Spanish and English .srt subtitles matching the title and release filename.
 */
final class SubtitleCat {
    private SubtitleCat() {}

    private static final String BASE = "https://www.subtitlecat.com";
    private static final int PAGES = 2;
    private static final int PER_LANG = 3;
    private static final Map<String, String> titleCache = new ConcurrentHashMap<>();

    private static final Set<String> STOP = new HashSet<>(Arrays.asList(
        "the", "a", "an", "of", "and", "el", "la", "los", "las", "de", "y"
    ));

    private static final Pattern ROW_RE = Pattern.compile(
        "<a href=\"(subs/\\d+/[^\"]+\\.html)\">([^<]{1,300})</a>\\s*(?:\\(translated from ([A-Za-z ]+)\\))?"
    );
    private static final Pattern FILE_RE = Pattern.compile(
        "href=\"(/subs/\\d+/[^\"]+?-([a-z]{2,3})(?:-([A-Za-z0-9]{2,4}))?\\.srt)\""
    );

    private static String unescapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&amp;", "&").replace("&quot;", "\"")
            .replace("&#039;", "'").replace("&#39;", "'")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ");
    }

    private static String foldAccents(String s) {
        if (s == null) return "";
        String norm = Normalizer.normalize(s, Normalizer.Form.NFD);
        return norm.replaceAll("[\\p{InCombiningDiacriticalMarks}]", "").toLowerCase(Locale.ROOT);
    }

    private static List<String> titleWords(String title) {
        List<String> out = new ArrayList<>();
        for (String w : foldAccents(title).split("[^a-z0-9]+")) {
            if (!w.isEmpty() && !STOP.contains(w)) out.add(w);
        }
        return out;
    }

    private static Set<String> tokens(String s) {
        Set<String> out = new HashSet<>();
        if (s == null) return out;
        String clean = s.toLowerCase(Locale.ROOT).replaceFirst("\\.[a-z0-9]{2,4}$", "");
        for (String t : clean.split("[^a-z0-9]+")) {
            if (t.length() > 1) out.add(t);
        }
        return out;
    }

    private static String httpGetText(String targetUrl, int timeoutMs) {
        String current = targetUrl;
        for (int hops = 0; hops < 3; hops++) {
            Http.Url u = Http.Url.parse(current);
            boolean secure = "https:".equals(u.protocol);
            if (u.hostname.isEmpty() || !(secure || "http:".equals(u.protocol))) return "";
            Http.Request r = new Http.Request();
            r.method = "GET";
            r.secure = secure;
            try {
                r.connectHost = Dnsx.prepare(u.hostname);
            } catch (java.io.IOException e) {
                return "";
            }
            if (r.connectHost.isEmpty()) r.connectHost = u.hostname;
            int defPort = secure ? 443 : 80;
            r.port = u.port.isEmpty() ? defPort : Integer.parseInt(u.port);
            r.tlsName = u.hostname;
            r.path = u.path;
            r.connectTimeout = timeoutMs;
            r.readTimeout = timeoutMs;
            r.headers.put("User-Agent", "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Safari/537.36");
            r.headers.put("Accept", "text/html,application/json,*/*");
            r.headers.put("Host", u.host());
            try (Http.Response res = Http.execute(r)) {
                if (res.status >= 300 && res.status < 400 && res.header("location") != null) {
                    current = Http.Url.resolve(current, res.header("location"));
                    continue;
                }
                if (res.status != 200) return "";
                return new String(res.readAll(512 * 1024), Crypto.UTF8);
            } catch (Exception e) {
                return "";
            }
        }
        return "";
    }

    private static String originalTitle(String imdbId, String kind) {
        String clean = (imdbId == null ? "" : imdbId).split(":")[0];
        if (!clean.matches("^tt\\d{5,10}$")) return null;
        String cached = titleCache.get(clean);
        if (cached != null) return cached;
        String type = "series".equals(kind) ? "series" : "movie";
        String body = httpGetText("https://v3-cinemeta.strem.io/meta/" + type + "/" + clean + ".json", 2500);
        if (body.isEmpty()) return null;
        try {
            JSONObject meta = new JSONObject(body).optJSONObject("meta");
            String name = meta != null ? Js.trim(meta.optString("name", "")) : "";
            if (!name.isEmpty()) {
                titleCache.put(clean, name);
                return name;
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static final class Row {
        final String path;
        final String release;
        final String from;
        int score;
        int index;
        Row(String path, String release, String from, int index) {
            this.path = path;
            this.release = release;
            this.from = from;
            this.index = index;
        }
    }

    static JSONArray search(JSONObject p) {
        JSONArray out = new JSONArray();
        if (p == null) return out;
        String imdbId = Js.text(p.opt("imdbId"));
        String kind = "series".equals(Js.text(p.opt("kind"))) ? "series" : "movie";
        String orig = originalTitle(imdbId, kind);
        String title = orig != null && !orig.isEmpty() ? orig : Js.text(p.opt("title"));
        String cleanTitle = foldAccents(title).replaceAll("[^a-z0-9' ]+", " ").replaceAll("\\s+", " ").trim();
        if (cleanTitle.isEmpty()) return out;

        int season = p.optInt("season", 0);
        int episode = p.optInt("episode", 0);
        String year = Js.text(p.opt("year"));
        String query;
        if ("series".equals(kind) && season > 0 && episode > 0) {
            query = String.format(Locale.ROOT, "%s S%02dE%02d", cleanTitle, season, episode);
        } else if (year.matches("^\\d{4}$")) {
            query = cleanTitle + " " + year;
        } else {
            query = cleanTitle;
        }

        String searchHtml;
        try {
            searchHtml = httpGetText(BASE + "/index.php?search=" + URLEncoder.encode(query, "UTF-8"), 4500);
        } catch (Exception e) {
            return out;
        }
        if (searchHtml.isEmpty()) return out;

        List<String> words = titleWords(title);
        if (words.isEmpty()) return out;
        Pattern sxe = ("series".equals(kind) && season > 0 && episode > 0)
            ? Pattern.compile("s0?" + season + "[ ._-]?e0?" + episode + "(?!\\d)", Pattern.CASE_INSENSITIVE)
            : null;
        String wantYear = (!"series".equals(kind) && year.matches("^\\d{4}$")) ? year : "";
        Set<String> fileToks = tokens(Js.text(p.opt("filename")));

        List<Row> kept = new ArrayList<>();
        Matcher rm = ROW_RE.matcher(searchHtml);
        int idx = 0;
        while (rm.find()) {
            String rPath = unescapeHtml(rm.group(1));
            String rRel = unescapeHtml(rm.group(2)).trim();
            String rFromRaw = rm.group(3) != null ? rm.group(3).trim().toLowerCase(Locale.ROOT) : "";
            String rFrom = "english".equals(rFromRaw) ? "en" : ("spanish".equals(rFromRaw) ? "es" : rFromRaw);
            List<String> relWords = titleWords(rRel);
            if (!relWords.containsAll(words)) continue;
            if (sxe != null) {
                if (!sxe.matcher(rRel).find()) continue;
            } else if (!wantYear.isEmpty() && !rRel.contains(wantYear)) {
                continue;
            }
            Row row = new Row(rPath, rRel, rFrom, idx++);
            if (!fileToks.isEmpty()) {
                for (String t : tokens(rRel)) {
                    if (fileToks.contains(t)) row.score++;
                }
            }
            kept.add(row);
        }
        if (kept.isEmpty()) return out;
        Collections.sort(kept, (a, b) -> b.score != a.score ? b.score - a.score : a.index - b.index);
        if (kept.size() > PAGES) kept = kept.subList(0, PAGES);

        List<List<String[]>> pageFiles = new ArrayList<>();
        for (Row r : kept) {
            String html = httpGetText(BASE + "/" + r.path.replaceFirst("^/+", ""), 4500);
            List<String[]> files = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            Matcher fm = FILE_RE.matcher(html);
            while (fm.find()) {
                String href = fm.group(1);
                String lang = fm.group(2);
                String region = fm.group(3) != null ? fm.group(3) : "";
                if ("orig".equals(lang) || !seen.add(href)) continue;
                files.add(new String[]{lang, region, BASE + unescapeHtml(href).replace(" ", "%20")});
            }
            pageFiles.add(files);
        }

        Map<String, Integer> perLang = new HashMap<>();
        for (String wantLang : new String[]{"es", "en"}) {
            for (int i = 0; i < kept.size(); i++) {
                Row r = kept.get(i);
                for (String[] f : pageFiles.get(i)) {
                    if (!wantLang.equals(f[0])) continue;
                    int count = perLang.containsKey(wantLang) ? perLang.get(wantLang) : 0;
                    if (count >= PER_LANG) continue;
                    perLang.put(wantLang, count + 1);
                    boolean translated = !r.from.isEmpty() && !r.from.equals(wantLang);
                    String code = "419".equals(f[1]) ? (wantLang + "-419") : (translated ? (wantLang + "-gt") : wantLang);
                    out.put(Js.o("lang", code, "url", f[2]));
                }
            }
        }
        return out;
    }
}
