# R8 rules for the release build (minifyEnabled true in build.gradle).
# Capacitor (its plugins and @PluginMethod methods) and Media3 bring their own
# rules; these are only for OpenTV's own code.

# Plugins are found by name from JavaScript (@CapacitorPlugin): keep them whole.
-keep class com.techpoint.opentv.NativePlayerPlugin { *; }
-keep class com.techpoint.opentv.MainActivity { *; }

# libtorrent4j: the SWIG layer is bound to the native library by class and
# method name (JNI, director callbacks), so it must not be renamed or removed.
# The small wrapper on top is kept whole too (alert mapping by type).
-keep class org.libtorrent4j.** { *; }
-dontwarn org.libtorrent4j.**

# Readable crash traces (class and line), without the source file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
