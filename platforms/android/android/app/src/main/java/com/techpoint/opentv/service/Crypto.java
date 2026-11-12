package com.techpoint.opentv.service;

import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/*
 * Portal body crypto and the live O3 signature, byte-identical to
 * service/magis.js (encryptBody, decryptBlob, liveDigestHex, signO3).
 *
 * Plain Java on purpose (no Android classes): platforms/android/tools/
 * compiles this file alone to compare its output with the Node functions.
 */
public final class Crypto {
    private Crypto() {}

    static final Charset UTF8 = Charset.forName("UTF-8");
    static final Charset ASCII = Charset.forName("US-ASCII");

    private static final String KEY_HEX = "e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8";
    private static final SecureRandom RANDOM = new SecureRandom();

    /* DESede/ECB/PKCS5 -> base64 -> hex of the base64 text (the wire form). */
    public static String encryptBody(String plain) throws Exception {
        Cipher c = Cipher.getInstance("DESede/ECB/PKCS5Padding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(fromHex(KEY_HEX), "DESede"));
        byte[] raw = c.doFinal(plain.getBytes(UTF8));
        return hex(base64(raw).getBytes(ASCII));
    }

    public static String decryptBlob(String wire) throws Exception {
        String b64 = new String(fromHex(wire), ASCII);
        Cipher d = Cipher.getInstance("DESede/ECB/PKCS5Padding");
        d.init(Cipher.DECRYPT_MODE, new SecretKeySpec(fromHex(KEY_HEX), "DESede"));
        return new String(d.doFinal(unbase64(b64)), UTF8);
    }

    public static String md5Hex(String text) throws Exception {
        return hex(MessageDigest.getInstance("MD5").digest(text.getBytes(UTF8)));
    }

    public static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return hex(b);
    }

    /* ------------------------------------------------------- live O3 digest
       MD5-shaped compression with a reordered first round; the constants are
       the ones in magis.js. */
    private static final int[] LIVE_K = {
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
        0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
        0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
        0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
        0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
        0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
        0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
        0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
        0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
        0x289b7ec6, 0xeaa127fa, 0xd46f3085, 0x04881d05,
        0xd9d4d039, 0xe6bd99e5, 0x1fa27cf8, 0xc4ac5665,
        0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
        0x655b59c3, 0x8f0ccc92, 0xffecc47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
        0xf7537e82, 0xbd3af235, 0x2da7d2bb, 0xeb86d391
    };
    private static final int[] LIVE_S = {
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    };
    private static final int[] LIVE_ROUND1 = {10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5};
    private static final int[] LIVE_G = new int[64];
    static {
        for (int i = 0; i < 64; i++) {
            LIVE_G[i] = i < 16 ? LIVE_ROUND1[i] : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : (7 * i) % 16;
        }
    }
    private static final byte[] LIVE_SALT = {
        0x73, 0x61, 0x6c, 0x74, 0x33, 0x33, 0x33, 0x33, 0x3d, 0x34,
        (byte) 0x98, 0x0d, 0x0a, 0x15, 0x32, (byte) 0xc9, (byte) 0xc3, (byte) 0x82, 0x17, 0x08, (byte) 0xc0
    };

    private static void liveCompress(int[] st, byte[] block, int off) {
        int[] m = new int[16];
        for (int j = 0; j < 16; j++) {
            int p = off + j * 4;
            m[j] = (block[p] & 0xff) | ((block[p + 1] & 0xff) << 8) | ((block[p + 2] & 0xff) << 16) | ((block[p + 3] & 0xff) << 24);
        }
        int a = st[0], b = st[1], c = st[2], d = st[3];
        for (int i = 0; i < 64; i++) {
            int f;
            if (i < 16) f = (b & c) | (~b & d);
            else if (i < 32) f = (d & b) | (~d & c);
            else if (i < 48) f = b ^ c ^ d;
            else f = c ^ (b | ~d);
            int sum = f + a + LIVE_K[i] + m[LIVE_G[i]];
            a = d; d = c; c = b;
            b = b + Integer.rotateLeft(sum, LIVE_S[i]);
        }
        st[0] += a; st[1] += b; st[2] += c; st[3] += d;
    }

    public static String liveDigestHex(byte[] bytes) {
        int[] st = {0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476};
        int len = bytes.length;
        int padLen = ((56 - ((len + 1) % 64)) + 64) % 64;
        byte[] total = new byte[len + 1 + padLen + 8];
        System.arraycopy(bytes, 0, total, 0, len);
        total[len] = (byte) 0x80;
        long bits = (long) len * 8;
        for (int i = 0; i < 8; i++) { total[len + 1 + padLen + i] = (byte) (bits >>> (8 * i)); }
        for (int off = 0; off < total.length; off += 64) { liveCompress(st, total, off); }
        StringBuilder out = new StringBuilder(32);
        for (int w = 0; w < 4; w++) {
            for (int j = 0; j < 4; j++) {
                int v = (st[w] >>> (8 * j)) & 0xff;
                if (v < 16) out.append('0');
                out.append(Integer.toHexString(v));
            }
        }
        return out.toString();
    }

    public static String signO3(String token, long startMomentMs) {
        byte[] head = ("token=" + token + "&sign2_method=sign_o3&instance=0&start_moment=" + startMomentMs).getBytes(UTF8);
        byte[] msg = new byte[head.length + LIVE_SALT.length];
        System.arraycopy(head, 0, msg, 0, head.length);
        System.arraycopy(LIVE_SALT, 0, msg, head.length, LIVE_SALT.length);
        return liveDigestHex(msg);
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

    /* Like Buffer.from(hex, 'hex'): stops at the first invalid pair. */
    public static byte[] fromHex(String s) {
        int n = s.length() / 2;
        byte[] out = new byte[n];
        for (int i = 0; i < n; i++) {
            int hi = Character.digit(s.charAt(i * 2), 16), lo = Character.digit(s.charAt(i * 2 + 1), 16);
            if (hi < 0 || lo < 0) {
                byte[] cut = new byte[i];
                System.arraycopy(out, 0, cut, 0, i);
                return cut;
            }
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
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
