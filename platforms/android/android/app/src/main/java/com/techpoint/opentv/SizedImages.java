package com.techpoint.opentv;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/**
 * Images at the size they are shown, like Glide in native TV apps.
 *
 * The page asks for https://opentv-img.local/i?w=<px>&u=<image url>. The
 * image is downloaded once, decoded already reduced (inSampleSize: the JPEG
 * decoder skips the detail it would throw away) and scaled to w pixels; that
 * small JPEG is kept on disk. The WebView never decodes a 1920 px cover for
 * a 250 px poster, which is what made the Fire TV stutter.
 */
final class SizedImages {
    static final String HOST = "opentv-img.local";
    private static final int MAX_BYTES = 12 * 1024 * 1024;
    private final File dir;

    SizedImages(File cacheDir) {
        dir = new File(cacheDir, "sized-images");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    WebResourceResponse serve(Uri uri) {
        String src = uri.getQueryParameter("u");
        int w;
        try { w = Integer.parseInt(uri.getQueryParameter("w")); } catch (Exception e) { w = 0; }
        if (src == null || !(src.startsWith("http://") || src.startsWith("https://")) || w < 16 || w > 3840) {
            return status(400);
        }
        File file = new File(dir, key(w + "|" + src) + ".jpg");
        try {
            if (file.length() > 0) { return image(new FileInputStream(file)); }
            byte[] raw = download(src);
            if (raw == null) { return status(404); }
            byte[] small = resize(raw, w);
            if (small == null) { return status(415); }
            File tmp = new File(dir, file.getName() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(small); }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(file);
            return image(new ByteArrayInputStream(small));
        } catch (Exception e) {
            return status(502);
        }
    }

    private static byte[] download(String src) throws Exception {
        URL url = new URL(src);
        for (int hop = 0; hop < 4; hop++) {
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(12000);
            c.setReadTimeout(15000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) OpenTV");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                url = new URL(url, c.getHeaderField("Location"));
                c.disconnect();
                continue;
            }
            if (code != 200) { c.disconnect(); return null; }
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream(256 * 1024);
                byte[] chunk = new byte[64 * 1024];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > MAX_BYTES) { return null; }
                }
                return buf.toByteArray();
            } finally {
                c.disconnect();
            }
        }
        return null;
    }

    private static byte[] resize(byte[] raw, int w) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) { return null; }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= w) { sample *= 2; }
        opts.inSampleSize = sample;
        Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
        if (bmp == null) { return null; }
        if (bmp.getWidth() > w) {
            int h = Math.max(1, Math.round(bmp.getHeight() * (w / (float) bmp.getWidth())));
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, w, h, true);
            if (scaled != bmp) { bmp.recycle(); }
            bmp = scaled;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 84, out);
        bmp.recycle();
        return out.toByteArray();
    }

    private static WebResourceResponse image(InputStream in) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "max-age=604800");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("image/jpeg", null, 200, "OK", headers, in);
    }

    private static WebResourceResponse status(int code) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", code, "Error", headers, new ByteArrayInputStream(new byte[0]));
    }

    private static String key(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder b = new StringBuilder();
            for (byte x : d) { b.append(String.format("%02x", x)); }
            return b.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
