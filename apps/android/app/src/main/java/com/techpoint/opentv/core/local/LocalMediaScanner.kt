package com.techpoint.opentv.core.local

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.compose.runtime.Immutable
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.ArrayDeque

@Immutable
data class LocalVideoEntry(
    val uri: String,
    val title: String,
    val name: String,
    val ext: String,
    val sizeBytes: Long,
    val durationMs: Long,
    val folder: String,
    val isUsb: Boolean = false,
)

object LocalMediaScanner {
    private val VIDEO_EXTS = setOf(
        "mp4", "m4v", "mkv", "webm", "avi", "mov", "ts", "m2ts", "flv", "wmv", "ogv", "mpg", "mpeg", "3gp",
    )
    private const val MAX_ITEMS = 120

    fun requiredVideoPermission(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_VIDEO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }

    fun hasReadVideoPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, requiredVideoPermission()) == PackageManager.PERMISSION_GRANTED

    fun cleanTitleFromFileName(name: String): String {
        val noExt = name.substringBeforeLast('.', name)
        return noExt
            .replace('.', ' ')
            .replace('_', ' ')
            .replace(Regex("\\s+"), " ")
            .trim()
            .ifBlank { "Video local" }
    }

    fun resolveDisplayName(context: Context, uri: Uri): String {
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) {
                        val n = c.getString(idx)
                        if (!n.isNullOrBlank()) return n
                    }
                }
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "Video local"
    }

    suspend fun scanDeviceVideos(context: Context): List<LocalVideoEntry> = withContext(Dispatchers.IO) {
        val out = ArrayList<LocalVideoEntry>(32)
        val seen = HashSet<String>()

        // 1. MediaStore.Video (internal storage, Downloads, Movies, DCIM, indexed SD cards)
        if (hasReadVideoPermission(context)) {
            runCatching {
                val projection = arrayOf(
                    MediaStore.Video.Media._ID,
                    MediaStore.Video.Media.DISPLAY_NAME,
                    MediaStore.Video.Media.TITLE,
                    MediaStore.Video.Media.SIZE,
                    MediaStore.Video.Media.DURATION,
                    MediaStore.Video.Media.BUCKET_DISPLAY_NAME,
                )
                context.contentResolver.query(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    "${MediaStore.Video.Media.DATE_MODIFIED} DESC",
                )?.use { cursor ->
                    val idCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
                    val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
                    val titleCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.TITLE)
                    val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
                    val durCol = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
                    val bucketCol = cursor.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)

                    while (cursor.moveToNext() && out.size < MAX_ITEMS) {
                        val id = cursor.getLong(idCol)
                        val name = cursor.getString(nameCol).orEmpty()
                        val rawTitle = cursor.getString(titleCol).orEmpty()
                        val size = cursor.getLong(sizeCol).coerceAtLeast(0L)
                        val dur = cursor.getLong(durCol).coerceAtLeast(0L)
                        val folder = if (bucketCol >= 0) cursor.getString(bucketCol).orEmpty() else ""
                        if (size < 64 * 1024) continue // skip tiny thumbnails/junk

                        val contentUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id)
                        val ext = name.substringAfterLast('.', "").uppercase()
                        val dedup = "${name.lowercase()}|$size"
                        if (seen.add(dedup)) {
                            out += LocalVideoEntry(
                                uri = contentUri.toString(),
                                title = if (rawTitle.isNotBlank() && rawTitle != name) rawTitle else cleanTitleFromFileName(name),
                                name = name.ifBlank { rawTitle },
                                ext = ext.ifBlank { "VIDEO" },
                                sizeBytes = size,
                                durationMs = dur,
                                folder = folder.ifBlank { "Dispositivo" },
                                isUsb = false,
                            )
                        }
                    }
                }
            }
        }

        // 2. Removable USB OTG / SD storage volumes under /storage/ (vital for Fire TV & Android TV)
        runCatching {
            val storageRoot = File("/storage")
            val volumes = storageRoot.listFiles()?.filter { dir ->
                dir.isDirectory &&
                    dir.canRead() &&
                    dir.name != "emulated" &&
                    dir.name != "self" &&
                    !dir.name.startsWith(".")
            }.orEmpty()

            for (vol in volumes) {
                if (out.size >= MAX_ITEMS) break
                val queue = ArrayDeque<Pair<File, Int>>()
                queue.add(vol to 0)
                while (queue.isNotEmpty() && out.size < MAX_ITEMS) {
                    val (dir, depth) = queue.removeFirst()
                    val children = dir.listFiles() ?: continue
                    for (f in children) {
                        if (out.size >= MAX_ITEMS) break
                        if (f.name.startsWith(".") || f.name.equals("Android", ignoreCase = true) || f.name.equals("LOST.DIR", ignoreCase = true)) {
                            continue
                        }
                        if (f.isDirectory) {
                            if (depth < 2) queue.add(f to (depth + 1))
                        } else if (f.isFile) {
                            val ext = f.extension.lowercase()
                            if (ext !in VIDEO_EXTS) continue
                            val size = f.length()
                            if (size < 64 * 1024) continue
                            val dedup = "${f.name.lowercase()}|$size"
                            if (seen.add(dedup)) {
                                out += LocalVideoEntry(
                                    uri = Uri.fromFile(f).toString(),
                                    title = cleanTitleFromFileName(f.name),
                                    name = f.name,
                                    ext = ext.uppercase(),
                                    sizeBytes = size,
                                    durationMs = 0L,
                                    folder = "USB · ${vol.name}",
                                    isUsb = true,
                                )
                            }
                        }
                    }
                }
            }
        }

        out
    }
}
