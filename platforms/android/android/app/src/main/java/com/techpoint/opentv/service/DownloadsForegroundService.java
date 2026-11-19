package com.techpoint.opentv.service;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import com.techpoint.opentv.MainActivity;
import com.techpoint.opentv.R;

import java.util.Locale;

/*
 * Keeps downloads going while the app is in the background (or swiped away)
 * and shows their progress in a system notification.
 *
 * Downloads.pump() starts it when something is downloading or queued; once a
 * second it reads Downloads.snapshot(), refreshes the notification and stops
 * itself (notification removed) when nothing is left. Type dataSync, as
 * Android 14 requires. Without the notification permission (Android 13+)
 * it still runs, only without a visible notification.
 *
 * Finished and failed downloads get their own dismissible notification
 * (notifyFinished). Tapping any of them opens the app with the extra
 * EXTRA_OPEN_DOWNLOADS, which MainActivity hands to the page.
 */
public final class DownloadsForegroundService extends Service {
    private static final String TAG = "OpenTV";
    public static final String EXTRA_OPEN_DOWNLOADS = "openDownloads";
    private static final String CHANNEL_PROGRESS = "descargas";
    private static final String CHANNEL_DONE = "descargas_listas";
    private static final int ID_PROGRESS = 7301;
    private static final String ACTION_PAUSE = "com.techpoint.opentv.DOWNLOAD_PAUSE";
    private static final String EXTRA_ID = "id";
    private static final long TICK_MS = 1000;
    private static final Locale ES = new Locale("es");

    private static volatile boolean alive;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private NotificationCompat.Builder builder;
    private String shownKey = "";
    private String pauseFor;   // the id the "Pausar" action was built for

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            refresh();
        }
    };

    /* From Downloads.pump(): idempotent, cheap while it already runs. */
    static void ensureRunning(Context context) {
        if (alive || context == null) return;
        try {
            ContextCompat.startForegroundService(context, new Intent(context, DownloadsForegroundService.class));
            alive = true;
        } catch (Throwable t) {
            // Android 12+ refuses a start from the background: the downloads
            // still run while the process lives.
            Log.w(TAG, "descargas: no se pudo iniciar el servicio en primer plano: " + t);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        alive = true;
        channels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_PAUSE.equals(intent.getAction())) {
            final String id = intent.getStringExtra(EXTRA_ID);
            if (id != null) {
                new Thread(() -> {
                    try { Downloads.action(id, "pause"); } catch (Exception e) { Log.w(TAG, "descargas: " + e); }
                }, "opentv-download-pause").start();
            }
        }
        // Every startForegroundService must be answered by startForeground
        // within a few seconds, even when the service already runs.
        Notification n = build(Downloads.snapshot());
        try {
            ServiceCompat.startForeground(this, ID_PROGRESS, n,
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
        } catch (Throwable t) {
            Log.w(TAG, "descargas: startForeground: " + t);
        }
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, TICK_MS);
        // Not sticky: the downloads live in this process; if it dies they go
        // on the next time the app opens.
        return START_NOT_STICKY;
    }

    private void refresh() {
        Downloads.Snapshot s = Downloads.snapshot();
        if (s.count == 0) {
            finish();
            return;
        }
        String key = s.key();
        if (!key.equals(shownKey) && canNotify(this)) {
            try {
                NotificationManagerCompat.from(this).notify(ID_PROGRESS, build(s));
            } catch (SecurityException ignored) { /* permission revoked meanwhile */ }
        }
        handler.postDelayed(tick, TICK_MS);
    }

    private void finish() {
        handler.removeCallbacks(tick);
        Downloads.flush();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        shownKey = "";
        alive = false;
        stopSelf();
        // A download queued between the snapshot and now: start again.
        if (Downloads.snapshot().count > 0) ensureRunning(getApplicationContext());
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        alive = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ------------------------------------------------------- notifications */

    private Notification build(Downloads.Snapshot s) {
        if (builder == null) {
            builder = new NotificationCompat.Builder(this, CHANNEL_PROGRESS)
                .setSmallIcon(R.drawable.ic_stat_download)
                .setContentIntent(openApp(this, 0))
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setShowWhen(false)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW);
        }
        String title, text;
        int percent = s.total > 0 ? (int) Math.min(100, s.bytes * 100 / s.total) : -1;
        if (s.count <= 1) {
            title = s.subtitle == null || s.subtitle.isEmpty() ? s.title : s.title + " · " + s.subtitle;
            if (title == null || title.isEmpty()) title = "Descarga";
            if ("downloading".equals(s.status)) {
                text = "Descargando"
                    + (percent >= 0 ? " · " + percent + " %" : (s.bytes > 0 ? " · " + size(s.bytes) : ""))
                    + (s.speed > 0 ? " · " + speed(s.speed) : "");
            } else {
                text = "paused".equals(s.status) ? "En pausa" : "En espera";
            }
        } else {
            title = "Descargando " + s.count + " títulos";
            text = (percent >= 0 ? percent + " % en total" : "Descargando")
                + (s.speed > 0 ? " · " + speed(s.speed) : "");
        }
        builder.setContentTitle(title).setContentText(text);
        if (percent >= 0) builder.setProgress(100, percent, false);
        else builder.setProgress(0, 0, s.count > 0);
        // One action, only for a single download: pause it.
        String pauseId = s.count == 1 ? s.id : null;
        if (pauseId == null ? pauseFor != null : !pauseId.equals(pauseFor)) {
            builder.clearActions();
            if (pauseId != null) {
                Intent i = new Intent(this, DownloadsForegroundService.class)
                    .setAction(ACTION_PAUSE).putExtra(EXTRA_ID, pauseId);
                PendingIntent pi = PendingIntent.getService(this, 1, i,
                    PendingIntent.FLAG_UPDATE_CURRENT | immutable());
                builder.addAction(0, "Pausar", pi);
            }
            pauseFor = pauseId;
        }
        shownKey = s.key();
        return builder.build();
    }

    /* A download finished or failed: its own dismissible notification. */
    static void notifyFinished(Context context, String id, String title, String subtitle, String error) {
        if (context == null || !canNotify(context)) return;
        channels(context);
        String name = subtitle == null || subtitle.isEmpty() ? title : title + " · " + subtitle;
        boolean ok = error == null;
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(ok ? "Descarga lista · " + name : "No se pudo descargar · " + name)
            .setContentIntent(openApp(context, 2))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(ok ? NotificationCompat.CATEGORY_STATUS : NotificationCompat.CATEGORY_ERROR)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (ok) b.setContentText("Ya puedes verla sin internet");
        else if (!error.isEmpty()) b.setContentText(error).setStyle(new NotificationCompat.BigTextStyle().bigText(error));
        try {
            NotificationManagerCompat.from(context).notify("descarga", id == null ? 0 : id.hashCode(), b.build());
        } catch (SecurityException ignored) { /* permission revoked meanwhile */ }
    }

    private static boolean canNotify(Context context) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    private static PendingIntent openApp(Context context, int code) {
        Intent i = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_OPEN_DOWNLOADS, true);
        return PendingIntent.getActivity(context, code, i, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
    }

    private static int immutable() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private static void channels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_DONE) != null) return;
        NotificationChannel progress = new NotificationChannel(CHANNEL_PROGRESS, "Descargas", NotificationManager.IMPORTANCE_LOW);
        progress.setSound(null, null);
        progress.enableVibration(false);
        progress.setShowBadge(false);
        nm.createNotificationChannel(progress);
        NotificationChannel done = new NotificationChannel(CHANNEL_DONE, "Descargas terminadas", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(done);
    }

    /* ------------------------------------------------------------ formats */

    private static String speed(long bytesPerSecond) {
        return size(bytesPerSecond) + "/s";
    }

    private static String size(long bytes) {
        if (bytes >= 1024L * 1024 * 1024) return String.format(ES, "%.1f GB", bytes / (1024.0 * 1024 * 1024));
        if (bytes >= 1024L * 1024) return String.format(ES, "%.1f MB", bytes / (1024.0 * 1024));
        if (bytes >= 1024) return (bytes / 1024) + " KB";
        return bytes + " B";
    }
}
