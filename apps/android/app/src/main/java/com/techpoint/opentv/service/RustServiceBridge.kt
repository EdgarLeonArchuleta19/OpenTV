package com.techpoint.opentv.service

import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Direct JNI bridge to the unified Rust core (`libopentv_service.so`).
 * Package & class name match the exported JNI symbols in `core/crates/opentv-android`.
 */
object RustServiceBridge {
    private const val TAG = "OpenTV-RS"
    const val DEFAULT_PORT = 8910
    const val TOKEN_HEADER = "X-OpenTV-Token"

    @Volatile
    private var loaded = false

    @Volatile
    private var boundPort = 0

    @Volatile
    private var appContext: Context? = null

    @Volatile
    var onDownloadStart: (() -> Unit)? = null

    private val token: String = buildToken()

    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    init {
        try {
            System.loadLibrary("opentv_service")
            loaded = true
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "No se pudo cargar libopentv_service.so: ${e.message}")
        }
    }

    fun isLoaded(): Boolean = loaded
    fun isStarted(): Boolean = boundPort > 0
    fun port(): Int = boundPort
    fun authToken(): String = token
    fun baseUrl(): String = if (boundPort > 0) "http://127.0.0.1:$boundPort" else ""

    fun isLowMemoryDevice(context: Context): Boolean {
        return runCatching {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            if (am?.isLowRamDevice == true) return true
            MediaCaps.isTvDevice(context)
        }.getOrDefault(true)
    }

    /** Idempotent startup — call on IO dispatcher at app launch. */
    @Synchronized
    fun start(context: Context): Int {
        appContext = context.applicationContext
        if (!loaded) return -1
        if (boundPort > 0) return boundPort

        val app = context.applicationContext
        val mediaCapsJson = MediaCaps.toJson(app)
        val cacheDir = app.cacheDir.absolutePath
        val downloadsDir = resolveDownloadsDir(app).apply { mkdirs() }.absolutePath
        val tmdbJson = readDecryptedTmdbAsset(app) ?: ""
        val verName = versionName(app)
        val verCode = versionCode(app)
        val abi = Build.SUPPORTED_ABIS.firstOrNull().orEmpty()
        val lowMem = isLowMemoryDevice(app)

        val port = startNative(
            DEFAULT_PORT,
            token,
            cacheDir,
            downloadsDir,
            tmdbJson,
            verName,
            verCode,
            abi,
            mediaCapsJson,
            lowMem,
        )
        if (port > 0) {
            boundPort = port
            Log.i(TAG, "Rust core activo en 127.0.0.1:$port (lowMem=$lowMem)")
        } else {
            Log.e(TAG, "Error iniciando Rust core: código $port")
        }
        return port
    }

    /** Direct in-process JNI RPC (~0.1 ms, zero loopback HTTP overhead). */
    suspend fun callRpc(method: String, params: JsonObject = buildJsonObject {}): JsonObject =
        withContext(Dispatchers.IO) {
            // Cold start: wait (bounded) for the Rust core instead of failing silently.
            if (loaded && boundPort <= 0) {
                var waited = 0
                while (boundPort <= 0 && waited < 8_000) {
                    delay(50)
                    waited += 50
                }
            }
            awaitPendingTorrentStop()
            callRpcSync(method, params)
        }

    /** Suspends (bounded) until the Rust core is bound; no-op when it is up or not loadable. */
    suspend fun awaitStarted(maxWaitMs: Int = 8_000) {
        if (!loaded || boundPort > 0) return
        var waited = 0
        while (boundPort <= 0 && waited < maxWaitMs) {
            delay(50)
            waited += 50
        }
    }

    fun callRpcSync(method: String, params: JsonObject = buildJsonObject {}): JsonObject {
        if (!loaded || boundPort <= 0) {
            return buildJsonObject {
                put("returnValue", false)
                put("errorText", "Servicio no iniciado")
            }
        }
        return runCatching {
            val raw = callRpcNative(method, params.toString())
            json.parseToJsonElement(raw).jsonObject
        }.getOrElse { e ->
            buildJsonObject {
                put("returnValue", false)
                put("errorText", e.message ?: "Error de servicio")
            }
        }
    }

    /** Builds a locally resized JPEG URL served by Rust's `/img` endpoint to cut RAM on TVs. */
    fun resizedImageUrl(url: String?, widthPx: Int): String? {
        if (url.isNullOrBlank()) return null
        if (boundPort <= 0) return url
        if (!url.startsWith("http://") && !url.startsWith("https://")) return url
        if (url.startsWith("http://127.0.0.1:")) return url
        val encoded = URLEncoder.encode(url, "UTF-8")
        return "http://127.0.0.1:$boundPort/img?u=$encoded&w=$widthPx&t=$token"
    }

    // Rust `stopTorrentNative` blocks on the tokio runtime; never run it on the main thread.
    private val torrentStopExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "opentv-torrent-stop").apply { isDaemon = true }
    }

    @Volatile
    private var pendingTorrentStop: Future<*>? = null

    /** Non-blocking: queues the stop on a dedicated thread. Later RPCs wait for it to finish. */
    fun stopTorrent() {
        if (loaded && boundPort > 0) {
            pendingTorrentStop = torrentStopExecutor.submit {
                runCatching { stopTorrentNative() }
            }
        }
    }

    /** Blocks the caller (never Main) until a queued torrent stop has completed. */
    private fun awaitPendingTorrentStop() {
        val f = pendingTorrentStop ?: return
        runCatching { f.get(6, TimeUnit.SECONDS) }
        if (pendingTorrentStop === f) pendingTorrentStop = null
    }

    fun stop() {
        if (loaded && boundPort > 0) {
            boundPort = 0
            runCatching { stopNative() }
        }
    }

    fun netguardRefusal(host: String, allowLan: Boolean): String? {
        if (!loaded) return "Servicio no disponible"
        return runCatching { netguardRefusalNative(host, allowLan) }
            .getOrDefault("Dirección no permitida")
    }

    /** Invoked from Rust JNI when `downloadStart` queues a new offline download. */
    @JvmStatic
    @Suppress("unused")
    fun onDownloadStartedFromRust() {
        runCatching { onDownloadStart?.invoke() }
        appContext?.let { DownloadsForegroundService.ensureRunning(it) }
    }

    /** Invoked from Rust JNI when `appUpdate({action: "install"})` launches Android's APK installer. */
    @JvmStatic
    @Suppress("unused")
    fun installApkFromRust(apkPath: String): String {
        val app = appContext ?: return errJson("El servicio aún no está listo")
        return runCatching {
            val file = File(apkPath)
            if (!file.isFile) return errJson("La actualización aún no está descargada")

            val pkg = app.packageName
            if (Build.VERSION.SDK_INT >= 26 && !app.packageManager.canRequestPackageInstalls()) {
                val allow = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$pkg"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                return try {
                    app.startActivity(allow)
                    """{"state":"needs-permission"}"""
                } catch (_: ActivityNotFoundException) {
                    buildJsonObject {
                        put("returnValue", false)
                        put("state", "needs-permission")
                        put("errorText", "Activa \"Apps de origen desconocido\" para OpenTV en Configuración")
                    }.toString()
                }
            }

            val intent = if (Build.VERSION.SDK_INT >= 24) {
                val uri = FileProvider.getUriForFile(app, "$pkg.fileprovider", file)
                Intent(Intent.ACTION_INSTALL_PACKAGE)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                file.setReadable(true, false)
                file.parentFile?.setExecutable(true, false)
                app.cacheDir.setExecutable(true, false)
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(Uri.fromFile(file), "application/vnd.android.package-archive")
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)

            try {
                app.startActivity(intent)
            } catch (_: ActivityNotFoundException) {
                app.startActivity(
                    Intent(Intent.ACTION_VIEW)
                        .setDataAndType(intent.data, intent.type)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            """{"state":"installing"}"""
        }.getOrElse { e ->
            errJson("No se pudo abrir el instalador: ${e.message}")
        }
    }

    private fun errJson(msg: String): String =
        buildJsonObject {
            put("returnValue", false)
            put("errorText", msg)
        }.toString()

    private fun buildToken(): String {
        val raw = ByteArray(24)
        SecureRandom().nextBytes(raw)
        return raw.joinToString("") { "%02x".format(it) }
    }

    private fun resolveDownloadsDir(ctx: Context): File {
        val ext = ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
        return if (ext != null) File(ext, "OpenTV") else File(ctx.filesDir, "descargas")
    }

    private fun versionName(ctx: Context): String =
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName.orEmpty() }
            .getOrDefault("")

    @Suppress("DEPRECATION")
    private fun versionCode(ctx: Context): Long =
        runCatching {
            val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        }.getOrDefault(0L)

    /** Decrypts optional `assets/tmdb.bin` in memory without ever leaving plaintext keys in APK. */
    private fun readDecryptedTmdbAsset(ctx: Context): String? {
        return runCatching {
            val raw = ctx.assets.open("tmdb.bin").use { it.readBytes() }
            if (raw.size < 1 + 12 + 32 + 16 || raw[0].toInt() != 1) return null
            val iv = raw.copyOfRange(1, 13)
            val mask = MessageDigest.getInstance("SHA-256")
                .digest("opentv:tmdb:mask:v1".toByteArray(StandardCharsets.UTF_8))
            val key = ByteArray(32) { i -> (raw[13 + i].toInt() xor mask[i].toInt()).toByte() }
            val cipherText = raw.copyOfRange(45, raw.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            String(cipher.doFinal(cipherText), StandardCharsets.UTF_8)
        }.getOrNull()
    }

    @JvmStatic
    private external fun startNative(
        port: Int,
        authToken: String,
        cacheDir: String,
        downloadsDir: String,
        tmdbJson: String,
        versionName: String,
        versionCode: Long,
        abi: String,
        mediaCapsJson: String,
        lowMemory: Boolean,
    ): Int

    @JvmStatic
    private external fun callRpcNative(method: String, paramsJson: String): String

    @JvmStatic
    private external fun stopTorrentNative()

    @JvmStatic
    private external fun netguardRefusalNative(host: String, allowLan: Boolean): String?

    @JvmStatic
    private external fun stopNative()
}
