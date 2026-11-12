package com.techpoint.opentv.service;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/*
 * Small HTTP/1.1 server bound to 127.0.0.1 only: one thread per connection,
 * keep-alive when the response length is known. It carries both the service
 * methods (:8910) and the media proxy (random port), like Node's http module
 * did for the PC bridge and proxy.js.
 */
final class LocalServer {
    interface Handler {
        void handle(Exchange ex) throws IOException;
    }

    private static final String TAG = "OpenTV";
    private final Handler handler;
    private final String name;
    private ServerSocket server;
    private final ExecutorService threads;

    LocalServer(String name, Handler handler) {
        this.name = name;
        this.handler = handler;
        this.threads = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "opentv-" + name);
            t.setDaemon(true);
            return t;
        });
    }

    int start(int port) throws IOException {
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 64);
        Thread accept = new Thread(this::acceptLoop, "opentv-" + name + "-accept");
        accept.setDaemon(true);
        accept.start();
        return server.getLocalPort();
    }

    int port() {
        return server == null ? 0 : server.getLocalPort();
    }

    private void acceptLoop() {
        while (!server.isClosed()) {
            try {
                final Socket s = server.accept();
                threads.execute(() -> serve(s));
            } catch (IOException e) {
                if (server.isClosed()) return;
                Log.w(TAG, name + ": accept " + e.getMessage());
            }
        }
    }

    private void serve(Socket s) {
        try {
            s.setTcpNoDelay(true);
            InputStream in = new BufferedInputStream(s.getInputStream(), 8192);
            OutputStream out = s.getOutputStream();
            while (true) {
                s.setSoTimeout(15000);   // idle keep-alive
                Exchange ex;
                try {
                    ex = Exchange.read(s, in, out);
                } catch (SocketTimeoutException e) {
                    break;
                }
                if (ex == null) break;
                s.setSoTimeout(0);
                try {
                    handler.handle(ex);
                } catch (Exception e) {
                    Log.w(TAG, name + " " + ex.target + ": " + e);
                    if (!ex.committed) {
                        try { ex.send(500, null, "error interno".getBytes(Crypto.UTF8)); } catch (IOException ignored) { break; }
                    } else {
                        break;
                    }
                }
                if (!ex.reusable()) break;
            }
        } catch (IOException ignored) {
            /* client went away */
        } finally {
            try { s.close(); } catch (IOException ignored) { /* closed */ }
        }
    }

    /* One request/response on a connection. */
    static final class Exchange {
        final Socket socket;
        final OutputStream out;
        String method;
        String target;
        final Map<String, String> headers = new HashMap<>();
        boolean committed;
        private boolean keepAlive;
        private boolean lengthKnown;

        private Exchange(Socket socket, OutputStream out) {
            this.socket = socket;
            this.out = out;
        }

        static Exchange read(Socket s, InputStream in, OutputStream out) throws IOException {
            String line = Http.readLine(in);
            while (line != null && line.isEmpty()) line = Http.readLine(in);
            if (line == null) return null;
            String[] parts = line.split(" ");
            if (parts.length < 2) return null;
            Exchange ex = new Exchange(s, out);
            ex.method = parts[0].toUpperCase(Locale.ROOT);
            ex.target = parts[1];
            String version = parts.length > 2 ? parts[2] : "HTTP/1.0";
            String h;
            while ((h = Http.readLine(in)) != null && !h.isEmpty()) {
                int colon = h.indexOf(':');
                if (colon > 0) ex.headers.put(h.substring(0, colon).trim().toLowerCase(Locale.ROOT), h.substring(colon + 1).trim());
            }
            String conn = ex.header("connection");
            ex.keepAlive = "HTTP/1.1".equals(version) ? !"close".equalsIgnoreCase(conn) : "keep-alive".equalsIgnoreCase(conn);
            // Request bodies are not used; read them so the next request parses.
            long length = 0;
            try { length = Long.parseLong(ex.header("content-length")); } catch (Exception ignored) { /* none */ }
            while (length > 0) {
                long skipped = in.skip(length);
                if (skipped <= 0) { if (in.read() < 0) break; skipped = 1; }
                length -= skipped;
            }
            return ex;
        }

        String header(String name) {
            return headers.get(name);
        }

        String path() {
            int q = target.indexOf('?');
            return q >= 0 ? target.substring(0, q) : target;
        }

        boolean reusable() {
            return keepAlive && lengthKnown;
        }

        void send(int status, Map<String, String> headers, byte[] body) throws IOException {
            Map<String, String> h = headers == null ? new LinkedHashMap<String, String>() : new LinkedHashMap<>(headers);
            boolean head = "HEAD".equals(method);
            if (body == null) body = new byte[0];
            h.put("Content-Length", String.valueOf(body.length));
            OutputStream o = begin(status, h);
            if (!head) o.write(body);
            o.flush();
        }

        /* Status line and headers; the body is then written to the stream.
           Without Content-Length the connection closes after the body. */
        OutputStream begin(int status, Map<String, String> headers) throws IOException {
            StringBuilder sb = new StringBuilder();
            sb.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n");
            boolean hasLength = status == 204 || status == 304;
            if (headers != null) {
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getValue() == null || "connection".equalsIgnoreCase(e.getKey())) continue;
                    if ("content-length".equalsIgnoreCase(e.getKey())) hasLength = true;
                    sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
                }
            }
            lengthKnown = hasLength;
            sb.append("Connection: ").append(keepAlive && hasLength ? "keep-alive" : "close").append("\r\n\r\n");
            committed = true;
            out.write(sb.toString().getBytes(Crypto.UTF8));
            return out;
        }

        void abort() {
            try { socket.close(); } catch (IOException ignored) { /* closed */ }
        }

        private static String reason(int status) {
            switch (status) {
                case 200: return "OK";
                case 204: return "No Content";
                case 206: return "Partial Content";
                case 301: return "Moved Permanently";
                case 302: return "Found";
                case 304: return "Not Modified";
                case 400: return "Bad Request";
                case 403: return "Forbidden";
                case 404: return "Not Found";
                case 410: return "Gone";
                case 416: return "Range Not Satisfiable";
                case 500: return "Internal Server Error";
                case 502: return "Bad Gateway";
                case 503: return "Service Unavailable";
                case 504: return "Gateway Timeout";
                default: return "Status";
            }
        }
    }
}
