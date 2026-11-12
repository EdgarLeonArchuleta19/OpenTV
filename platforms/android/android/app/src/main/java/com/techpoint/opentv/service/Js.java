package com.techpoint.opentv.service;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * The service code is a line-by-line port of service/*.js, so these helpers
 * keep JavaScript's semantics where the responses depend on them: String()
 * of numbers, truthiness, parseInt and Number().
 */
final class Js {
    private Js() {}

    static boolean isNull(Object v) {
        return v == null || v == JSONObject.NULL;
    }

    /* text() in magis.js: String(value), '' for null/undefined. */
    static String text(Object v) {
        if (isNull(v)) return "";
        if (v instanceof Number) return num((Number) v);
        return String.valueOf(v);
    }

    /* JavaScript's \s, which also covers NBSP, BOM and the Unicode spaces. */
    private static final String JS_SPACE = "[\\s\\u00a0\\ufeff\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
    private static final Pattern TRIM = Pattern.compile("^" + JS_SPACE + "+|" + JS_SPACE + "+$");

    static String trim(Object v) {
        return TRIM.matcher(text(v)).replaceAll("");
    }

    /* String(number) for the values JSON can carry. */
    static String num(Number n) {
        if (n instanceof Double || n instanceof Float) {
            double d = n.doubleValue();
            if (Double.isNaN(d)) return "NaN";
            if (Double.isInfinite(d)) return d > 0 ? "Infinity" : "-Infinity";
            if (d == Math.rint(d) && Math.abs(d) < 1e21) return Long.toString((long) d);
            String s = Double.toString(d);
            return s.contains("E") ? new java.math.BigDecimal(d).stripTrailingZeros().toPlainString() : s;
        }
        return n.toString();
    }

    static boolean truthy(Object v) {
        if (isNull(v)) return false;
        if (v instanceof Boolean) return (Boolean) v;
        if (v instanceof String) return !((String) v).isEmpty();
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            return d != 0 && !Double.isNaN(d);
        }
        return true;
    }

    /* a || b || ... */
    static Object or(Object... values) {
        for (int i = 0; i < values.length - 1; i++) {
            if (truthy(values[i])) return values[i];
        }
        return values[values.length - 1];
    }

    private static final Pattern INT_PREFIX = Pattern.compile("^\\s*([+-]?\\d+)");

    /* parseInt(value, 10); null stands for NaN. */
    static Long parseInt(Object v) {
        if (isNull(v)) return null;
        Matcher m = INT_PREFIX.matcher(text(v));
        if (!m.find()) return null;
        try {
            return Long.parseLong(m.group(1).startsWith("+") ? m.group(1).substring(1) : m.group(1));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /* parseInt(v, 10) || fallback */
    static long intOr(Object v, long fallback) {
        Long n = parseInt(v);
        return n == null || n == 0 ? fallback : n;
    }

    /* Number(value); NaN when not numeric. */
    static double number(Object v) {
        if (isNull(v)) return v == null ? Double.NaN : 0;
        if (v instanceof Number) return ((Number) v).doubleValue();
        if (v instanceof Boolean) return ((Boolean) v) ? 1 : 0;
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return 0;
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return Double.NaN;
        }
    }

    /* A JSON number from a double: whole values become longs so they print
       like JavaScript (5400, not 5400.0). */
    static Number jsonNum(double d) {
        if (d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 9e15) return (long) d;
        return d;
    }

    static JSONObject obj(Object v) {
        return v instanceof JSONObject ? (JSONObject) v : null;
    }

    static JSONArray arr(Object v) {
        return v instanceof JSONArray ? (JSONArray) v : null;
    }

    /* value of a key, null when absent (undefined) or when obj is not an object. */
    static Object get(Object o, String key) {
        JSONObject j = obj(o);
        return j == null ? null : j.opt(key);
    }

    static JSONObject getObj(Object o, String key) {
        return obj(get(o, key));
    }

    static JSONArray getArr(Object o, String key) {
        return arr(get(o, key));
    }

    static int len(JSONArray a) {
        return a == null ? 0 : a.length();
    }

    static Object parse(String raw) throws org.json.JSONException {
        return new JSONTokener(raw).nextValue();
    }

    static JSONObject o(Object... kv) {
        JSONObject out = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        } catch (org.json.JSONException ignored) { /* keys are literals */ }
        return out;
    }

    static void put(JSONObject o, String key, Object value) {
        try {
            o.put(key, value);
        } catch (org.json.JSONException ignored) { /* NaN never reaches here */ }
    }
}
