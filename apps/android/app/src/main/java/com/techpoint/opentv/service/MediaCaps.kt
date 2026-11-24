package com.techpoint.opentv.service

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.media.AudioFormat
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import androidx.media3.exoplayer.audio.AudioCapabilities
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.Locale

@Serializable
data class DeviceMediaCaps(
    val dts: Boolean = false,
    val truehd: Boolean = false,
    val eac3: Boolean = false,
    val ac3: Boolean = false,
    val atmos: Boolean = false,
    val hevc: Boolean = false,
    val hevc10: Boolean = false,
    val av1: Boolean = false,
    val uhd: Boolean = false,
    val hdr: Boolean = false,
)

/**
 * Detects hardware video decoders, HDMI/device surround audio capabilities
 * (AC-3, E-AC-3, Dolby Atmos JOC, TrueHD, DTS), and 4K/HDR display support once per process.
 */
object MediaCaps {
    private const val HEVC_MAIN10 = 0x2
    private const val HEVC_MAIN10_HDR10 = 0x1000
    private const val HEVC_MAIN10_HDR10_PLUS = 0x2000

    @Volatile
    private var cached: DeviceMediaCaps? = null

    private val json = Json { encodeDefaults = true }

    fun get(context: Context): DeviceMediaCaps {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            val detected = detect(context.applicationContext)
            cached = detected
            return detected
        }
    }

    fun toJson(context: Context): String = json.encodeToString(get(context))

    fun isTvDevice(context: Context): Boolean {
        val ui = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        val pm = context.packageManager
        if (pm.hasSystemFeature("android.software.leanback")) return true
        if (pm.hasSystemFeature("amazon.hardware.fire_tv")) return true
        return Build.MODEL.startsWith("AFT", ignoreCase = true)
    }

    private fun detect(context: Context): DeviceMediaCaps {
        var dts = false
        var truehd = false
        var eac3 = false
        var ac3 = false
        var atmos = false
        var hevc = false
        var hevc10 = false
        var av1 = false

        runCatching {
            val list = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            for (info in list) {
                if (info.isEncoder) continue
                val hw = isHardwareCodec(info)
                for (type in info.supportedTypes) {
                    when (type.lowercase(Locale.ROOT)) {
                        "audio/vnd.dts", "audio/vnd.dts.hd" -> dts = true
                        "audio/true-hd" -> truehd = true
                        "audio/eac3-joc" -> {
                            eac3 = true
                            atmos = true
                        }
                        "audio/eac3" -> eac3 = true
                        "audio/ac3" -> ac3 = true
                        "video/hevc" -> if (hw) {
                            hevc = true
                            if (!hevc10 && hasMain10(info, type)) hevc10 = true
                        }
                        "video/av01" -> if (hw) av1 = true
                    }
                }
            }
        }

        // Check HDMI / device passthrough capabilities via Media3 AudioCapabilities
        runCatching {
            val audioCaps = AudioCapabilities.getCapabilities(context, androidx.media3.common.AudioAttributes.DEFAULT, null)
            if (audioCaps.supportsEncoding(AudioFormat.ENCODING_AC3)) ac3 = true
            if (audioCaps.supportsEncoding(AudioFormat.ENCODING_E_AC3)) eac3 = true
            if (Build.VERSION.SDK_INT >= 28 && audioCaps.supportsEncoding(AudioFormat.ENCODING_E_AC3_JOC)) {
                eac3 = true
                atmos = true
            }
            if (Build.VERSION.SDK_INT >= 29 && audioCaps.supportsEncoding(AudioFormat.ENCODING_DOLBY_TRUEHD)) {
                truehd = true
            }
            if (audioCaps.supportsEncoding(AudioFormat.ENCODING_DTS) ||
                audioCaps.supportsEncoding(AudioFormat.ENCODING_DTS_HD)
            ) {
                dts = true
            }
        }

        var uhd = false
        var hdr = false
        runCatching {
            val dm = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
            val display = dm?.getDisplay(Display.DEFAULT_DISPLAY)
            if (display != null) {
                for (mode in display.supportedModes) {
                    if (maxOf(mode.physicalWidth, mode.physicalHeight) >= 3840) {
                        uhd = true
                        break
                    }
                }
                if (Build.VERSION.SDK_INT >= 24) {
                    val hdrCaps = display.hdrCapabilities
                    if (hdrCaps != null && hdrCaps.supportedHdrTypes.isNotEmpty()) {
                        hdr = true
                    }
                }
            }
        }

        return DeviceMediaCaps(
            dts = dts,
            truehd = truehd,
            eac3 = eac3,
            ac3 = ac3,
            atmos = atmos,
            hevc = hevc,
            hevc10 = hevc10,
            av1 = av1,
            uhd = uhd,
            hdr = hdr,
        )
    }

    private fun isHardwareCodec(info: MediaCodecInfo): Boolean {
        if (Build.VERSION.SDK_INT >= 29) {
            return info.isHardwareAccelerated && !info.isSoftwareOnly
        }
        val name = info.name.lowercase(Locale.ROOT)
        return !name.startsWith("omx.google.") &&
            !name.startsWith("c2.android.") &&
            !name.contains(".sw.")
    }

    private fun hasMain10(info: MediaCodecInfo, type: String): Boolean {
        return runCatching {
            val caps = info.getCapabilitiesForType(type)
            caps.profileLevels.any {
                it.profile == HEVC_MAIN10 ||
                    it.profile == HEVC_MAIN10_HDR10 ||
                    it.profile == HEVC_MAIN10_HDR10_PLUS
            }
        }.getOrDefault(false)
    }
}
