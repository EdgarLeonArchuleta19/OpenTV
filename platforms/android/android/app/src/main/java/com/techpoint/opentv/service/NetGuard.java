package com.techpoint.opentv.service;

import java.io.IOException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/*
 * Where the JS plugins may connect (pluginFetch, the hidden browser). The
 * address is checked after resolving the name, and the request then goes to
 * that same address (a name cannot answer "public" to the check and
 * "127.0.0.1" to the connection):
 *   - this device's loopback (127.0.0.0/8, ::1, localhost): never;
 *   - the home network (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10,
 *     fc00::/7, fe80::/10): only when the viewer allowed that plugin;
 *   - 0.0.0.0/8, multicast and reserved ranges: never.
 * Same rules as service/netguard.js.
 */
public final class NetGuard {
    private NetGuard() {}

    private static final Pattern V4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");
    private static final Pattern MAPPED = Pattern.compile("^::ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$");

    static final int PUBLIC = 0, LAN = 1, LOOPBACK = 2, BLOCKED = 3;

    static int classify(String ipText) {
        String ip = ipText == null ? "" : ipText.replace("[", "").replace("]", "").toLowerCase(Locale.ROOT);
        Matcher mapped = MAPPED.matcher(ip);
        if (mapped.matches()) ip = mapped.group(1);
        Matcher m = V4.matcher(ip);
        if (m.matches()) {
            int a = Integer.parseInt(m.group(1)), b = Integer.parseInt(m.group(2));
            if (a > 255 || b > 255 || Integer.parseInt(m.group(3)) > 255 || Integer.parseInt(m.group(4)) > 255) return BLOCKED;
            if (a == 127) return LOOPBACK;
            if (a == 0 || a >= 224) return BLOCKED;
            if (a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254) ||
                (a == 100 && b >= 64 && b <= 127)) return LAN;
            return PUBLIC;
        }
        if (ip.indexOf(':') >= 0) {
            if (ip.equals("::1")) return LOOPBACK;
            if (ip.equals("::") || ip.startsWith("ff")) return BLOCKED;
            if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") ||
                ip.startsWith("fea") || ip.startsWith("feb")) return LAN;
            return PUBLIC;
        }
        return BLOCKED;
    }

    private static boolean allowed(int kind, boolean allowLan) {
        return kind == PUBLIC || (kind == LAN && allowLan);
    }

    private static String refusal(int kind) {
        if (kind == LAN) return "Este plugin no tiene permiso para usar la red de tu casa";
        if (kind == LOOPBACK) return "No se permite conectar con el propio aparato";
        return "Dirección no permitida";
    }

    /* The address to connect to, or PortalException with why not. */
    static String check(String hostname, boolean allowLan) throws PortalException {
        String host = hostname == null ? "" : hostname.replace("[", "").replace("]", "").toLowerCase(Locale.ROOT);
        if (host.isEmpty()) throw new PortalException("Host inválido");
        if (host.equals("localhost") || host.endsWith(".localhost")) throw new PortalException(refusal(LOOPBACK));
        if (V4.matcher(host).matches() || host.indexOf(':') >= 0) {
            int kind = classify(host);
            if (!allowed(kind, allowLan)) throw new PortalException(refusal(kind));
            return host;
        }
        Dnsx.Result r;
        try {
            r = Dnsx.resolve(host);
        } catch (IOException e) {
            throw new PortalException("No se pudo resolver " + host);
        }
        if (r == null || r.ips == null || r.ips.isEmpty()) throw new PortalException("No se pudo resolver " + host);
        // Every address of the name must pass (a mixed answer is refused).
        for (String ip : r.ips) {
            int kind = classify(ip);
            if (!allowed(kind, allowLan)) throw new PortalException(refusal(kind));
        }
        return r.ips.get(0);
    }

    /* For the hidden browser (another package): null when the host may be
       reached, else why not. It may resolve the name: not on the UI thread. */
    public static String refusal(String hostname, boolean allowLan) {
        try {
            check(hostname, allowLan);
            return null;
        } catch (PortalException e) {
            return e.getMessage();
        }
    }
}
