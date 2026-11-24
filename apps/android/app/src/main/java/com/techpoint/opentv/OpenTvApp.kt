package com.techpoint.opentv

import android.app.ActivityManager
import android.app.Application
import android.graphics.Bitmap
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.allowHardware
import coil3.request.bitmapConfig
import coil3.request.crossfade
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.data.AppStore
import com.techpoint.opentv.core.data.CatalogRepository
import com.techpoint.opentv.core.jsplugins.JsPluginHost
import com.techpoint.opentv.core.ranking.PlaybackProfile
import com.techpoint.opentv.core.live.LiveTvRepository
import com.techpoint.opentv.player.OpenTvPlayer
import com.techpoint.opentv.service.DeviceMediaCaps
import com.techpoint.opentv.service.MediaCaps
import com.techpoint.opentv.service.RustServiceBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okio.Path.Companion.toOkioPath
import java.io.File

/**
 * Application container owning the single shared Rust core, Coil 3 image pipeline
 * tuned for 1 GB Fire TV Sticks, persistent AppStore, StremioClient and ExoPlayer.
 */
class OpenTvApp : Application(), SingletonImageLoader.Factory {

    lateinit var store: AppStore
        private set
    lateinit var stremio: StremioClient
        private set
    lateinit var liveRepo: LiveTvRepository
        private set
    lateinit var catalogs: CatalogRepository
        private set
    lateinit var jsPlugins: JsPluginHost
        private set
    lateinit var player: OpenTvPlayer
        private set
    /** Codec/audio caps: detected off the main thread at start-up (cached by [MediaCaps]). */
    val mediaCaps: DeviceMediaCaps
        get() = MediaCaps.get(this)

    var isTv: Boolean = false
        private set
    var isLowSpec: Boolean = false
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        isTv = MediaCaps.isTvDevice(this)
        // Same rule as RustServiceBridge.isLowMemoryDevice, but without touching that object:
        // its init loads the 6 MB native core, which must not happen on the main thread.
        isLowSpec = runCatching {
            (getSystemService(ACTIVITY_SERVICE) as? ActivityManager)?.isLowRamDevice == true || isTv
        }.getOrDefault(true)

        store = AppStore(this)
        stremio = StremioClient()
        catalogs = CatalogRepository(stremio, cacheDir)
        liveRepo = LiveTvRepository()
        jsPlugins = JsPluginHost(this, isLowSpec)
        player = OpenTvPlayer(this, isLowSpec)

        // Start unified Rust core off the main thread immediately at cold start.
        // MediaCodecList enumeration + native library load happen here while the boot splash shows.
        appScope.launch {
            MediaCaps.get(this@OpenTvApp)
            // RAM / ABI / network snapshot for the automatic 720p-vs-1080p choice.
            runCatching { PlaybackProfile.refresh(this@OpenTvApp) }
            RustServiceBridge.start(this@OpenTvApp)
        }
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader {
        val am = getSystemService(ACTIVITY_SERVICE) as? ActivityManager
        val lowRam = isLowSpec || (am?.isLowRamDevice == true)

        return ImageLoader.Builder(context)
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = { stremio.http }))
            }
            // RGB_565 cuts poster bitmap memory in HALF on 1 GB Fire TV Sticks.
            .bitmapConfig(if (lowRam) Bitmap.Config.RGB_565 else Bitmap.Config.ARGB_8888)
            .allowHardware(true)
            .crossfade(if (isTv) 0 else 160)
            .memoryCache {
                MemoryCache.Builder()
                    .maxSizePercent(context, if (lowRam) 0.15 else 0.25)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(File(cacheDir, "coil_posters").toOkioPath())
                    .maxSizeBytes(if (lowRam) 64L * 1024 * 1024 else 128L * 1024 * 1024)
                    .build()
            }
            .build()
    }

    override fun onTerminate() {
        player.release()
        jsPlugins.destroy()
        RustServiceBridge.stop()
        super.onTerminate()
    }
}
