# R8 rules for the release build (minifyEnabled true in build.gradle).
# Capacitor (its plugins and @PluginMethod methods) and Media3 bring their own
# rules; these are only for OpenTV's own code.

# Plugins are found by name from JavaScript (@CapacitorPlugin): keep them whole.
-keep class com.techpoint.opentv.NativePlayerPlugin { *; }
-keep class com.techpoint.opentv.MainActivity { *; }

# Readable crash traces (class and line), without the source file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
