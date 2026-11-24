# Keep JNI bridge class & static callbacks invoked from Rust (libopentv_service.so)
-keep class com.techpoint.opentv.service.RustServiceBridge {
    public static void onDownloadStartedFromRust();
    public static java.lang.String installApkFromRust(java.lang.String);
    native <methods>;
}

# Keep kotlinx.serialization generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.techpoint.opentv.**$$serializer { *; }
-keepclassmembers class com.techpoint.opentv.** {
    *** Companion;
}
-keepclasseswithmembers class com.techpoint.opentv.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Media3 ExoPlayer keep rules for dynamically instantiated decoders/extractors
-keep class androidx.media3.exoplayer.hls.HlsMediaSource$Factory { <init>(...); }
-keep class androidx.media3.exoplayer.dash.DashMediaSource$Factory { <init>(...); }
-keep class androidx.media3.exoplayer.smoothstreaming.SsMediaSource$Factory { <init>(...); }
-keep class androidx.media3.exoplayer.rtsp.RtspMediaSource$Factory { <init>(...); }
-keep class androidx.media3.decoder.ffmpeg.** { *; }
-keep class androidx.media3.extractor.** { *; }
