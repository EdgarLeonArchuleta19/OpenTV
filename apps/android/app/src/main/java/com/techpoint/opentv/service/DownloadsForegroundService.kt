package com.techpoint.opentv.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.techpoint.opentv.MainActivity
import com.techpoint.opentv.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.Locale

/**
 * Keeps offline downloads alive on Android phones/tablets and shows live progress
 * notifications by querying `downloadSnapshot` directly via Rust JNI.
 */
class DownloadsForegroundService : Service() {
    companion object {
        private const val TAG = "OpenTV.Downloads"
        const val EXTRA_OPEN_DOWNLOADS = "openDownloads"
        private const val CHANNEL_PROGRESS = "descargas"
        private const val CHANNEL_DONE = "descargas_listas"
        private const val ID_PROGRESS = 7301
        private const val ACTION_PAUSE = "com.techpoint.opentv.DOWNLOAD_PAUSE"
        private const val EXTRA_ID = "id"

        @Volatile
        private var alive = false

        fun ensureRunning(context: Context) {
            if (alive) return
            runCatching {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, DownloadsForegroundService::class.java),
                )
                alive = true
            }.onFailure {
                Log.w(TAG, "No se pudo iniciar el servicio de descargas: ${it.message}")
            }
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null
    private var lastKey = ""

    override fun onCreate() {
        super.onCreate()
        alive = true
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PAUSE) {
            val id = intent.getStringExtra(EXTRA_ID)
            if (!id.isNullOrBlank()) {
                scope.launch {
                    RustServiceBridge.callRpc(
                        "downloadAction",
                        buildJsonObject {
                            put("id", id)
                            put("action", "pause")
                        },
                    )
                }
            }
        }

        val initial = buildProgressNotification(
            count = 1,
            id = "",
            title = "Descargas",
            subtitle = "Preparando descarga…",
            bytes = 0,
            total = 0,
            speed = 0,
        )
        runCatching {
            ServiceCompat.startForeground(
                this,
                ID_PROGRESS,
                initial,
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
            )
        }

        if (pollJob?.isActive != true) {
            pollJob = scope.launch { pollLoop() }
        }
        return START_NOT_STICKY
    }

    private suspend fun pollLoop() {
        while (scope.isActive) {
            val snap = RustServiceBridge.callRpc("downloadSnapshot")
            val active = (snap["active"] as? JsonArray).orEmpty()
            val finished = (snap["finished"] as? JsonArray).orEmpty()

            if (finished.isNotEmpty() && canNotify()) {
                for (el in finished) {
                    val obj = el as? JsonObject ?: continue
                    val id = (obj["id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                    val title = (obj["title"] as? JsonPrimitive)?.contentOrNull ?: "Descarga completada"
                    val status = (obj["status"] as? JsonPrimitive)?.contentOrNull ?: "done"
                    notifyFinished(id, title, status == "done")
                }
            }

            if (active.isEmpty()) {
                stopSelf()
                return
            }

            val first = active.first() as? JsonObject ?: JsonObject(emptyMap())
            val id = (first["id"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            val title = (first["title"] as? JsonPrimitive)?.contentOrNull ?: "Descargando"
            val subtitle = (first["subtitle"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            val bytes = (first["bytes"] as? JsonPrimitive)?.longOrNull ?: 0L
            val total = (first["total"] as? JsonPrimitive)?.longOrNull ?: 0L
            val speed = (first["speed"] as? JsonPrimitive)?.longOrNull ?: 0L
            val pct = if (total > 0) ((bytes * 100) / total).toInt().coerceIn(0, 100) else -1
            val key = "${active.size}|$id|$pct|${speed / 65536}"

            if (key != lastKey && canNotify()) {
                lastKey = key
                NotificationManagerCompat.from(this@DownloadsForegroundService).notify(
                    ID_PROGRESS,
                    buildProgressNotification(active.size, id, title, subtitle, bytes, total, speed),
                )
            }
            delay(1000)
        }
    }

    private fun buildProgressNotification(
        count: Int,
        id: String,
        title: String,
        subtitle: String,
        bytes: Long,
        total: Long,
        speed: Long,
    ): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
            .putExtra(EXTRA_OPEN_DOWNLOADS, true)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val openPending = PendingIntent.getActivity(
            this,
            10,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val pct = if (total > 0) ((bytes * 100) / total).toInt().coerceIn(0, 100) else 0
        val speedText = if (speed > 0) String.format(Locale("es"), "%.1f MB/s", speed / 1_048_576.0) else ""
        val text = buildString {
            if (subtitle.isNotBlank()) append(subtitle).append(" · ")
            if (total > 0) append("$pct%") else append("Descargando…")
            if (speedText.isNotBlank()) append(" · ").append(speedText)
            if (count > 1) append(" (+${count - 1} más)")
        }

        val builder = NotificationCompat.Builder(this, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openPending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setProgress(100, pct, total <= 0)

        if (id.isNotBlank()) {
            val pauseIntent = Intent(this, DownloadsForegroundService::class.java)
                .setAction(ACTION_PAUSE)
                .putExtra(EXTRA_ID, id)
            val pausePending = PendingIntent.getService(
                this,
                11,
                pauseIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(0, "Pausar", pausePending)
        }
        return builder.build()
    }

    private fun notifyFinished(id: String, title: String, ok: Boolean) {
        val openIntent = Intent(this, MainActivity::class.java)
            .putExtra(EXTRA_OPEN_DOWNLOADS, true)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPending = PendingIntent.getActivity(
            this,
            id.hashCode(),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(this, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(if (ok) "Descarga lista" else "Error en descarga")
            .setContentText(title)
            .setContentIntent(openPending)
            .setAutoCancel(true)
            .build()
        runCatching {
            NotificationManagerCompat.from(this).notify(7400 + (id.hashCode() and 0x3FF), n)
        }
    }

    private fun canNotify(): Boolean {
        return Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROGRESS, "Descargas en curso", NotificationManager.IMPORTANCE_LOW)
                .apply { setShowBadge(false) },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_DONE, "Descargas completadas", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    override fun onDestroy() {
        alive = false
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
