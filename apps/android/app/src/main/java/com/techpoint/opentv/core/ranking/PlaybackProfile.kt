package com.techpoint.opentv.core.ranking

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build

/** Hardware + network snapshot used for the automatic target quality. */
data class PlaybackEnv(
    /** Total RAM in MB (0 = unknown). */
    val totalRamMb: Long = 0,
    /** `ActivityManager.isLowRamDevice` (Fire TV Stick 1 GB, Android Go). */
    val lowRamDevice: Boolean = false,
    /** Device exposes a 64-bit ABI (false on armeabi-v7a-only Fire TV Sticks). */
    val is64Bit: Boolean = true,
    /** App-measured throughput, Mbit/s (0 = no sample yet). */
    val measuredMbps: Double = 0.0,
    /** `linkDownstreamBandwidthKbps` of the active network, Mbit/s (0 = unknown). */
    val linkMbps: Double = 0.0,
    /** Metered/cellular network or data saver. */
    val constrained: Boolean = false,
    /** Android TV / Fire TV: auto quality is always HD (720p) so titles start faster. */
    val isTv: Boolean = false,
)

/**
 * Owner rule (same as the PC `deviceProfile.ts`): a capable device on a fast
 * connection prefers Full HD (1080p); low RAM / 32-bit Fire TV Sticks or slow
 * networks prefer HD (720p). TVs (Fire TV / Android TV) always prefer HD (720p) so
 * everything loads faster. Auto never picks 4K: that is a manual choice.
 */
object PlaybackProfile {
    /** Comfortable headroom for a 1080p HLS ladder (≈ 5 Mbit/s top variant). */
    const val FULL_HD_MIN_MBPS = 12.0
    private const val MIN_SAMPLE_BYTES = 256L * 1024L
    private const val PREFS = "opentv_playback_profile"
    private const val KEY_MBPS = "netMbps"

    @Volatile
    var current: PlaybackEnv = PlaybackEnv()
        private set

    @Volatile
    private var appContext: Context? = null

    /** Marks the device as a TV (set at app start, before any ranking runs). */
    fun setTv(tv: Boolean) {
        current = current.copy(isTv = tv)
    }

    /** Reads RAM / ABI / active network once (cheap); call again when the network may have changed. */
    fun refresh(context: Context) {
        val ctx = context.applicationContext
        appContext = ctx
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val mem = ActivityManager.MemoryInfo()
        runCatching { am?.getMemoryInfo(mem) }
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val caps = runCatching { cm?.getNetworkCapabilities(cm.activeNetwork) }.getOrNull()
        val linkKbps = caps?.linkDownstreamBandwidthKbps ?: 0
        val metered = runCatching { cm?.isActiveNetworkMetered == true }.getOrDefault(false)
        val cellular = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
        val saved = runCatching {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getFloat(KEY_MBPS, 0f).toDouble()
        }.getOrDefault(0.0)
        current = current.copy(
            totalRamMb = mem.totalMem / (1024L * 1024L),
            lowRamDevice = am?.isLowRamDevice == true,
            is64Bit = Build.SUPPORTED_64_BIT_ABIS.isNotEmpty(),
            measuredMbps = if (current.measuredMbps > 0.0) current.measuredMbps else saved,
            linkMbps = linkKbps / 1000.0,
            constrained = cellular || (metered && caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) != true),
        )
    }

    /**
     * One download sample (bytes over wall time) from plugin pages, segments...
     * Small transfers are latency-bound and ignored. EWMA, cached across runs.
     */
    fun recordThroughput(bytes: Long, millis: Long) {
        if (bytes < MIN_SAMPLE_BYTES || millis <= 0L) return
        val mbps = bytes * 8.0 / (millis * 1000.0)
        if (mbps <= 0.0 || mbps > 10_000.0) return
        val prev = current.measuredMbps
        val next = if (prev > 0.0) prev * 0.7 + mbps * 0.3 else mbps
        current = current.copy(measuredMbps = next)
        appContext?.let { ctx ->
            runCatching {
                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putFloat(KEY_MBPS, next.toFloat()).apply()
            }
        }
    }

    /** "1080p" or "720p" for `SourcePrefs.quality == "auto"`. */
    fun autoTarget(env: PlaybackEnv): String {
        if (env.isTv) return "720p"
        if (env.constrained) return "720p"
        // Fire TV Stick 1 GB (armeabi-v7a, low RAM): 1080p HLS + Compose UI runs out of memory.
        if (env.lowRamDevice) return "720p"
        if (env.totalRamMb in 1 until 1_800) return "720p"
        if (!env.is64Bit && env.totalRamMb in 1 until 3_000) return "720p"
        if (env.measuredMbps > 0.0) return if (env.measuredMbps >= FULL_HD_MIN_MBPS) "1080p" else "720p"
        if (env.linkMbps > 0.0 && env.linkMbps < FULL_HD_MIN_MBPS) return "720p"
        return "1080p"
    }
}
