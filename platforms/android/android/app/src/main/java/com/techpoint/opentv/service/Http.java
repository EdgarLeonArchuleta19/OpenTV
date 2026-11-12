package com.techpoint.opentv.service;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.EOFException;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/*
 * Minimal HTTP/1.1 client. The service needs what Node's http/https options
 * give it and HttpURLConnection does not: connect to an address chosen by DoH
 * while TLS SNI, certificate check and the Host header keep the hostname
 * (or "cachefly.net" for the CacheFly CDN, see Proxy). Its own code instead
 * of OkHttp keeps Kotlin out of the APK.
 */
final class Http {
    private Http() {}

    static final class Request {
        String method = "GET";
        boolean secure;
        String connectHost;          // IP (or hostname for the system resolver)
        int port;
        String tlsName;              // SNI and certificate name
        String path = "/";
        final Map<String, String> headers = new LinkedHashMap<>();
        byte[] body;
        int connectTimeout = 15000;
        int readTimeout = 20000;
    }

    static final class Response implements Closeable {
        int status;
        final Map<String, String> headers = new HashMap<>();   // lower-case names
        InputStream body;
        private Conn conn;
        private boolean reusable;
        private Body framed;

        String header(String name) {
            return headers.get(name.toLowerCase(Locale.ROOT));
        }

        byte[] readAll(long max) throws IOException {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = body.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (max > 0 && out.size() > max) throw new IOException("respuesta demasiado grande");
            }
            return out.toByteArray();
        }

        /* After reading the whole body the socket goes back to the pool. */
        @Override public void close() {
            Conn c = conn;
            conn = null;
            if (c == null) return;
            if (reusable && framed != null && framed.done) Pool.put(c);
            else c.close();
        }

        void setReadTimeout(int ms) {
            Conn c = conn;
            if (c == null) return;
            try { c.socket.setSoTimeout(ms); } catch (IOException ignored) { /* closed */ }
        }

        /* Abort from another thread (abortMedia, channel change). */
        void abort() {
            Conn c = conn;
            conn = null;
            if (c != null) c.close();
        }
    }

    /* A request that another thread can cancel (DoH race, killActiveStreams). */
    static final class Call {
        private volatile Conn conn;
        private volatile boolean cancelled;

        Response execute(Request r) throws IOException {
            boolean fresh = false;
            for (int attempt = 0; attempt < 2; attempt++) {
                if (cancelled) throw new IOException("cancelada");
                Conn c = attempt == 0 ? Pool.take(key(r)) : null;
                if (c == null) { c = open(r); fresh = true; }
                conn = c;
                if (cancelled) { c.close(); throw new IOException("cancelada"); }
                try {
                    return send(c, r);
                } catch (IOException e) {
                    c.close();
                    // A pooled socket the server already closed: retry once on a new one.
                    if (fresh || cancelled || c.gotBytes) throw e;
                }
            }
            throw new IOException("sin conexión");
        }

        void cancel() {
            cancelled = true;
            Conn c = conn;
            if (c != null) c.close();
        }
    }

    static Response execute(Request r) throws IOException {
        return new Call().execute(r);
    }

    /* ------------------------------------------------------------ internals */
    static final class Conn {
        final String key;
        final Socket socket;
        final InputStream in;
        final OutputStream out;
        long idleSince;
        volatile boolean gotBytes;

        Conn(String key, Socket socket) throws IOException {
            this.key = key;
            this.socket = socket;
            this.in = new BufferedInputStream(socket.getInputStream(), 32768);
            this.out = socket.getOutputStream();
        }

        void close() {
            try { socket.close(); } catch (IOException ignored) { /* closed */ }
        }
    }

    private static String key(Request r) {
        return (r.secure ? "s|" : "p|") + r.connectHost + "|" + r.port + "|" + (r.secure ? r.tlsName : "");
    }

    /* Hostnames (system resolver) may list an IPv6 address first that the
       network cannot reach: try every address, IPv4 first. */
    private static Socket connect(Request r) throws IOException {
        java.net.InetAddress[] all = java.net.InetAddress.getAllByName(r.connectHost);
        java.util.List<java.net.InetAddress> order = new java.util.ArrayList<>();
        for (java.net.InetAddress a : all) if (a instanceof java.net.Inet4Address) order.add(a);
        for (java.net.InetAddress a : all) if (!(a instanceof java.net.Inet4Address)) order.add(a);
        IOException last = null;
        for (java.net.InetAddress a : order) {
            Socket s = new Socket();
            try {
                s.setTcpNoDelay(true);
                s.connect(new InetSocketAddress(a, r.port), r.connectTimeout);
                return s;
            } catch (IOException e) {
                last = e;
                try { s.close(); } catch (IOException ignored) { /* closed */ }
            }
        }
        throw last != null ? last : new IOException("sin dirección para " + r.connectHost);
    }

    private static Conn open(Request r) throws IOException {
        Socket raw = connect(r);
        try {
            raw.setSoTimeout(r.readTimeout);
            if (!r.secure) return new Conn(key(r), raw);
            SSLSocketFactory f = (SSLSocketFactory) SSLSocketFactory.getDefault();
            // Passing the name (not the IP) makes it the SNI.
            SSLSocket ssl = (SSLSocket) f.createSocket(raw, r.tlsName, r.port, true);
            ssl.startHandshake();
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(r.tlsName, ssl.getSession())) {
                ssl.close();
                throw new SSLException("certificado no válido para " + r.tlsName);
            }
            return new Conn(key(r), ssl);
        } catch (IOException e) {
            try { raw.close(); } catch (IOException ignored) { /* closed */ }
            throw e;
        }
    }

    private static Response send(Conn c, Request r) throws IOException {
        c.socket.setSoTimeout(r.readTimeout);
        c.gotBytes = false;
        StringBuilder head = new StringBuilder();
        head.append(r.method).append(' ').append(r.path).append(" HTTP/1.1\r\n");
        boolean hasLength = false;
        for (Map.Entry<String, String> h : r.headers.entrySet()) {
            String v = h.getValue();
            if (v == null || h.getKey().indexOf('\n') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) continue;
            if ("content-length".equalsIgnoreCase(h.getKey())) hasLength = true;
            head.append(h.getKey()).append(": ").append(v).append("\r\n");
        }
        if (r.body != null && !hasLength) head.append("Content-Length: ").append(r.body.length).append("\r\n");
        head.append("\r\n");
        c.out.write(head.toString().getBytes(Crypto.UTF8));
        if (r.body != null) c.out.write(r.body);
        c.out.flush();

        Response res = new Response();
        String line;
        do {
            line = readLine(c.in);
            if (line == null) throw new EOFException("conexión cerrada sin respuesta");
            c.gotBytes = true;
            String[] parts = line.split(" ", 3);
            if (parts.length < 2 || !parts[0].startsWith("HTTP/")) throw new IOException("respuesta HTTP no válida");
            res.status = Integer.parseInt(parts[1].trim());
            res.headers.clear();
            String h;
            while ((h = readLine(c.in)) != null && !h.isEmpty()) {
                int colon = h.indexOf(':');
                if (colon <= 0) continue;
                String name = h.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = h.substring(colon + 1).trim();
                String prev = res.headers.get(name);
                res.headers.put(name, prev == null ? value : prev + ", " + value);
            }
            if (h == null) throw new EOFException("cabeceras incompletas");
        } while (res.status >= 100 && res.status < 200);

        boolean close = "close".equalsIgnoreCase(res.header("connection")) || parts0(line);
        long length = -1;
        boolean chunked = res.header("transfer-encoding") != null && res.header("transfer-encoding").toLowerCase(Locale.ROOT).contains("chunked");
        if ("HEAD".equals(r.method) || res.status == 204 || res.status == 304) {
            length = 0;
        } else if (!chunked && res.header("content-length") != null) {
            try { length = Long.parseLong(res.header("content-length").trim()); } catch (NumberFormatException e) { length = -1; }
        }
        Body body = new Body(c.in, chunked, length);
        res.framed = body;
        res.body = body;
        res.conn = c;
        res.reusable = !close && (chunked || length >= 0);
        return res;
    }

    private static boolean parts0(String statusLine) {
        return statusLine.startsWith("HTTP/1.0");
    }

    static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') {
                int n = sb.length();
                if (n > 0 && sb.charAt(n - 1) == '\r') sb.setLength(n - 1);
                return sb.toString();
            }
            sb.append((char) b);
            if (sb.length() > 65536) throw new IOException("línea HTTP demasiado larga");
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    /* Body framing: content-length, chunked, or until the server closes. */
    static final class Body extends FilterInputStream {
        private final boolean chunked;
        private long remaining;      // bytes left (or left in the current chunk)
        boolean done;

        Body(InputStream in, boolean chunked, long length) {
            super(in);
            this.chunked = chunked;
            this.remaining = chunked ? 0 : length;
            if (!chunked && length == 0) done = true;
        }

        @Override public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n <= 0 ? -1 : one[0] & 0xff;
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (done) return -1;
            if (chunked) {
                if (remaining == 0) {
                    String size = readLine(in);
                    if (size == null) throw new EOFException("chunk incompleto");
                    int semi = size.indexOf(';');
                    remaining = Long.parseLong((semi >= 0 ? size.substring(0, semi) : size).trim(), 16);
                    if (remaining == 0) {
                        String t;
                        while ((t = readLine(in)) != null && !t.isEmpty()) { /* trailers */ }
                        done = true;
                        return -1;
                    }
                }
                int n = in.read(b, off, (int) Math.min(len, remaining));
                if (n < 0) throw new EOFException("chunk incompleto");
                remaining -= n;
                if (remaining == 0) readLine(in);
                return n;
            }
            if (remaining < 0) {
                int n = in.read(b, off, len);
                if (n < 0) done = true;
                return n;
            }
            int n = in.read(b, off, (int) Math.min(len, remaining));
            if (n < 0) throw new EOFException("respuesta incompleta");
            remaining -= n;
            if (remaining == 0) done = true;
            return n;
        }

        @Override public void close() { /* Response.close decides */ }
    }

    static final class Pool {
        private static final long IDLE_MS = 15000;
        private static final int PER_KEY = 4;
        private static final Map<String, ArrayDeque<Conn>> idle = new HashMap<>();

        static synchronized Conn take(String key) {
            ArrayDeque<Conn> q = idle.get(key);
            long now = System.currentTimeMillis();
            while (q != null && !q.isEmpty()) {
                Conn c = q.pollLast();
                if (now - c.idleSince < IDLE_MS && !c.socket.isClosed()) return c;
                c.close();
            }
            return null;
        }

        static synchronized void put(Conn c) {
            ArrayDeque<Conn> q = idle.get(c.key);
            if (q == null) { q = new ArrayDeque<>(); idle.put(c.key, q); }
            c.idleSince = System.currentTimeMillis();
            q.addLast(c);
            while (q.size() > PER_KEY) q.pollFirst().close();
        }
    }

    /* Splits a URL like Node's url.parse for the parts the service uses. */
    static final class Url {
        String protocol = "";   // "http:" / "https:"
        String hostname = "";
        String port = "";       // "" when absent
        String path = "/";      // pathname + search

        String host() { return port.isEmpty() ? hostname : hostname + ":" + port; }

        static Url parse(String s) {
            Url u = new Url();
            if (s == null) return u;
            java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^([a-zA-Z][a-zA-Z0-9+.-]*:)//([^/?#]*)([^#]*)").matcher(s.trim());
            if (!m.find()) return u;
            u.protocol = m.group(1).toLowerCase(Locale.ROOT);
            String auth = m.group(2);
            int at = auth.lastIndexOf('@');
            if (at >= 0) auth = auth.substring(at + 1);
            int colon = auth.lastIndexOf(':');
            if (colon >= 0 && auth.indexOf(']') < colon) {
                u.hostname = auth.substring(0, colon).toLowerCase(Locale.ROOT);
                u.port = auth.substring(colon + 1);
            } else {
                u.hostname = auth.toLowerCase(Locale.ROOT);
            }
            String rest = m.group(3);
            u.path = rest.isEmpty() ? "/" : (rest.startsWith("/") ? rest : "/" + rest);
            return u;
        }

        /* url.resolve(base, ref) for absolute, scheme-relative, absolute-path
           and relative references. */
        static String resolve(String base, String ref) {
            // java.net.URI drops the last segment for "?x" (RFC 2396) and
            // refuses unescaped characters; the manual form covers both.
            if (ref.startsWith("?")) return manualResolve(base, ref);
            try {
                java.net.URI b = new java.net.URI(base);
                if (b.getRawPath() == null || b.getRawPath().isEmpty()) b = new java.net.URI(base + "/");
                return b.resolve(new java.net.URI(ref)).toString();
            } catch (Exception e) {
                return manualResolve(base, ref);
            }
        }

        private static String manualResolve(String base, String ref) {
            if (ref.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) return ref;
            Url b = parse(base);
            String origin = b.protocol + "//" + b.host();
            if (ref.startsWith("//")) return b.protocol + ref;
            if (ref.startsWith("/")) return origin + ref;
            String path = b.path;
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            if (ref.startsWith("?")) return origin + path + ref;
            return origin + path.substring(0, path.lastIndexOf('/') + 1) + ref;
        }
    }
}
