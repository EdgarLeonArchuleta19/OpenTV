package com.techpoint.opentv.service;

import java.nio.charset.Charset;
import java.security.SecureRandom;

/*
 * Small encoding helpers for the service: charsets, random tokens, hex and
 * base64 (the proxy's /hls/<token>/<base64url> child routes).
 */
public final class Crypto {
    private Crypto() {}

    static final Charset UTF8 = Charset.forName("UTF-8");

    private static final SecureRandom RANDOM = new SecureRandom();

    public static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return hex(b);
    }

    /* ------------------------------------------------------------- encoding
       java.util.Base64 needs API 26 and android.util.Base64 is Android only. */
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static final String B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    public static String hex(byte[] b) {
        char[] out = new char[b.length * 2];
        for (int i = 0; i < b.length; i++) {
            out[i * 2] = HEX[(b[i] >> 4) & 15];
            out[i * 2 + 1] = HEX[b[i] & 15];
        }
        return new String(out);
    }

    public static String base64(byte[] b) {
        StringBuilder sb = new StringBuilder((b.length + 2) / 3 * 4);
        for (int i = 0; i < b.length; i += 3) {
            int n = (b[i] & 0xff) << 16;
            if (i + 1 < b.length) n |= (b[i + 1] & 0xff) << 8;
            if (i + 2 < b.length) n |= b[i + 2] & 0xff;
            sb.append(B64.charAt((n >> 18) & 63)).append(B64.charAt((n >> 12) & 63));
            sb.append(i + 1 < b.length ? B64.charAt((n >> 6) & 63) : '=');
            sb.append(i + 2 < b.length ? B64.charAt(n & 63) : '=');
        }
        return sb.toString();
    }

    /* Lenient like Node: skips characters outside the alphabet, accepts the
       URL-safe alphabet and missing padding. */
    public static byte[] unbase64(String s) {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(s.length() * 3 / 4);
        int acc = 0, bits = 0;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            int v;
            if (ch == '=') break;
            if (ch == '-') v = 62;
            else if (ch == '_') v = 63;
            else v = B64.indexOf(ch);
            if (v < 0) continue;
            acc = (acc << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((acc >> bits) & 0xff);
            }
        }
        return out.toByteArray();
    }

    public static String base64Url(String value) {
        String b = base64(value.getBytes(UTF8));
        int end = b.length();
        while (end > 0 && b.charAt(end - 1) == '=') end--;
        return b.substring(0, end).replace('+', '-').replace('/', '_');
    }

    public static String fromBase64Url(String value) {
        return new String(unbase64(value), UTF8);
    }
}
