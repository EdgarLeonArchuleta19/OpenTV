package com.techpoint.opentv.service;

import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Port of service/media-duration.js without its FFmpeg probe (Android has no
 * ffmpeg). get() answers what media-duration.js answers when the probe cannot
 * run: the catalogue duration, verified=false.
 */
final class MediaDuration {
    private MediaDuration() {}

    private static final int MAX_ENTRIES = 100;

    private static final class Entry {
        final double duration;
        final boolean verified;
        Entry(double duration, boolean verified) { this.duration = duration; this.verified = verified; }
    }

    private static final Map<String, Entry> entries = new LinkedHashMap<String, Entry>() {
        @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, MediaDuration.Entry> eldest) { return size() > MAX_ENTRIES; }
    };

    private static final Pattern NONE = Pattern.compile("^(?:n/a|none|null|undefined|unknown|infinity|—|-)$");
    private static final Pattern PLAIN = Pattern.compile("^\\d+(?:\\.\\d+)?$");
    private static final Pattern CLOCK = Pattern.compile("^(\\d+):(\\d{1,2}(?:\\.\\d+)?)(?::(\\d{1,2}(?:\\.\\d+)?))?$");
    private static final Pattern UNIT = Pattern.compile(
        "(\\d+(?:\\.\\d+)?)\\s*(horas?|hours?|hrs?|h|minutos?|minutes?|mins?|min|m|segundos?|seconds?|secs?|sec|seg|s)(?![a-z])");

    /* seconds(value) in media-duration.js: numbers (ms above 100000), clock
       strings and "1 h 30 min" forms. */
    static double seconds(Object value) {
        if (value instanceof Number) {
            double v = ((Number) value).doubleValue();
            return !Double.isNaN(v) && !Double.isInfinite(v) && v > 0 ? (v > 100000 ? v / 1000 : v) : 0;
        }
        if (!(value instanceof String)) return 0;
        String raw = ((String) value).trim().toLowerCase(Locale.ROOT).replace(',', '.');
        if (raw.isEmpty() || NONE.matcher(raw).matches()) return 0;
        if (PLAIN.matcher(raw).matches()) return seconds(Double.parseDouble(raw));
        Matcher clock = CLOCK.matcher(raw);
        if (clock.matches()) {
            double first = Double.parseDouble(clock.group(1)), middle = Double.parseDouble(clock.group(2));
            if (middle >= 60 || (clock.group(3) != null && Double.parseDouble(clock.group(3)) >= 60)) return 0;
            return clock.group(3) == null ? first * 60 + middle : first * 3600 + middle * 60 + Double.parseDouble(clock.group(3));
        }
        double total = 0;
        boolean found = false;
        Matcher m = UNIT.matcher(raw);
        while (m.find()) {
            char c = m.group(2).charAt(0);
            double mult = c == 'h' ? 3600 : c == 'm' ? 60 : 1;
            total += Double.parseDouble(m.group(1)) * mult;
            found = true;
        }
        return found && !Double.isInfinite(total) && total > 0 ? total : 0;
    }

    static synchronized String register(JSONObject stream) {
        String id = Crypto.randomHex(16);
        entries.put(id, new Entry(seconds(stream.opt("duration")), Boolean.TRUE.equals(stream.opt("durationVerified"))));
        return id;
    }

    static synchronized JSONObject get(Object id) throws PortalException {
        Entry e = id instanceof String && ((String) id).matches("^[0-9a-f]{32}$") ? entries.get(id) : null;
        if (e == null) throw new PortalException("Referencia de vídeo no disponible");
        return Js.o("duration", Js.jsonNum(e.duration), "available", e.duration > 0, "verified", e.duration > 0 && e.verified);
    }
}
