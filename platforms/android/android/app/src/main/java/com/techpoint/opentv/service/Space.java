package com.techpoint.opentv.service;

import android.os.StatFs;

import java.io.File;
import java.util.Locale;

/*
 * Free and total bytes of the volume holding a directory (StatFs: one
 * syscall, cheap enough for ping). A Fire TV Stick has a few GB free, so the
 * torrent cache and the downloads check it before writing.
 */
final class Space {
    private Space() {}

    static final long MB = 1024L * 1024L;

    /* Bytes an app can still write there; -1 when unknown. */
    static long free(File dir) {
        File d = existing(dir);
        if (d == null) return -1;
        try {
            return new StatFs(d.getAbsolutePath()).getAvailableBytes();
        } catch (Throwable t) {
            return -1;
        }
    }

    static long total(File dir) {
        File d = existing(dir);
        if (d == null) return -1;
        try {
            return new StatFs(d.getAbsolutePath()).getTotalBytes();
        } catch (Throwable t) {
            return -1;
        }
    }

    /* The directory or its nearest existing parent (StatFs needs a real path). */
    private static File existing(File dir) {
        File d = dir;
        while (d != null && !d.exists()) d = d.getParentFile();
        return d;
    }

    /* "1,4 GB" / "350 MB", for messages shown to the viewer. */
    static String human(long bytes) {
        if (bytes >= 1024 * MB) return String.format(new Locale("es"), "%.1f GB", bytes / (1024.0 * MB));
        return Math.max(1, Math.round(bytes / (double) MB)) + " MB";
    }
}
