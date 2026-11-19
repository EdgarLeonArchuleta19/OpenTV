package com.techpoint.opentv.service;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Port of service/m3u.js. TV en vivo: the viewer's own M3U lists. fetchM3u
 * downloads a list (http/s, redirects, size cap, DoH-prepared like the rest
 * of the service) and parseM3u turns it into channels
 * { name, logo, group, url, streamUrl, channelCode, index, isAddon, now, fav }.
 */
final class M3u {
    private M3u() {}

    private static final Pattern TVG_LOGO = Pattern.compile("tvg-logo=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);
    private static final Pattern GROUP_TITLE = Pattern.compile("group-title=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);
    private static final Pattern HTTP_URL = Pattern.compile("^https?://", Pattern.CASE_INSENSITIVE);

    static JSONArray parseM3u(String content) {
        String[] lines = (content == null ? "" : content).split("\\r?\\n", -1);
        JSONArray channels = new JSONArray();
        JSONObject cur = null;
        for (String raw : lines) {
            String line = Js.trim(raw);
            if (line.startsWith("#EXTINF:")) {
                int comma = line.indexOf(',');
                String meta = comma > 0 ? line.substring(Math.min(8, comma), comma) : line.substring(8);
                String title = comma > 0 ? Js.trim(line.substring(comma + 1)) : "Canal";
                Matcher logo = TVG_LOGO.matcher(meta);
                Matcher group = GROUP_TITLE.matcher(meta);
                cur = Js.o("name", title, "logo", logo.find() ? logo.group(1) : "", "group", group.find() ? group.group(1) : "Addon",
                    "isAddon", true, "now", "En vivo", "fav", false);
            } else if (!line.isEmpty() && !line.startsWith("#") && cur != null) {
                Js.put(cur, "url", line);
                Js.put(cur, "streamUrl", line);
                Js.put(cur, "channelCode", "m3u_" + (channels.length() + 1));
                Js.put(cur, "index", channels.length() + 1);
                channels.put(cur);
                cur = null;
            }
        }
        return channels;
    }

    private static final long M3U_MAX_BYTES = 20L * 1024 * 1024;
    private static final int M3U_MAX_REDIRECTS = 5;

    static JSONArray fetchM3u(String urlStr) throws Exception {
        for (int redirects = 0; ; redirects++) {
            if (urlStr == null || urlStr.isEmpty()) throw new PortalException("URL de la lista requerida");
            if (!HTTP_URL.matcher(urlStr).find()) throw new PortalException("La lista debe ser una dirección http(s)");
            if (redirects > M3U_MAX_REDIRECTS) throw new PortalException("Demasiadas redirecciones al descargar la lista");
            Http.Url u = Http.Url.parse(urlStr);
            boolean secure = urlStr.startsWith("https://");
            int port = u.port.isEmpty() ? (secure ? 443 : 80) : Integer.parseInt(u.port);
            Http.Request r = new Http.Request();
            r.secure = secure;
            r.connectHost = Dnsx.prepare(u.hostname);
            r.port = port;
            r.tlsName = u.hostname;
            r.path = u.path;
            r.connectTimeout = 20000;
            r.readTimeout = 20000;
            r.headers.put("User-Agent", "Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/538.1+ (KHTML, like Gecko) Safari/538.1+");
            r.headers.put("Host", u.hostname + (port != (secure ? 443 : 80) ? ":" + port : ""));
            Http.Response res;
            try {
                res = Http.execute(r);
            } catch (java.net.SocketTimeoutException e) {
                throw new PortalException("Tiempo de espera agotado al descargar la lista");
            }
            try {
                if (res.status >= 300 && res.status < 400 && res.header("location") != null) {
                    urlStr = Http.Url.resolve(urlStr, res.header("location"));
                    continue;
                }
                if (res.status != 200) throw new PortalException("HTTP " + res.status + " al descargar la lista");
                byte[] body;
                try {
                    body = res.readAll(M3U_MAX_BYTES);
                } catch (java.net.SocketTimeoutException e) {
                    throw new PortalException("Tiempo de espera agotado al descargar la lista");
                } catch (IOException e) {
                    if ("respuesta demasiado grande".equals(e.getMessage())) throw new PortalException("La lista es demasiado grande");
                    throw e;
                }
                return parseM3u(new String(body, Crypto.UTF8));
            } finally {
                res.abort();
            }
        }
    }
}
