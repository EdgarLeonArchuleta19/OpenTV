package com.techpoint.opentv.core.data

/**
 * SemVer version comparison and mandatory update enforcement policy shared across
 * Android phone, Android TV and Fire TV, matching Rust (`opentv-core::app_update`)
 * and PC TypeScript (`version.ts`) 1:1.
 */
object AppUpdatePolicy {

    private fun parseSemver(raw: String): Pair<LongArray, String?> {
        val trimmed = raw.trim().removePrefix("v").removePrefix("V")
        val noBuild = trimmed.substringBefore("+")
        val dashIdx = noBuild.indexOf('-')
        val coreStr = if (dashIdx >= 0) noBuild.substring(0, dashIdx) else noBuild
        val pre = if (dashIdx >= 0) noBuild.substring(dashIdx + 1).ifBlank { null } else null
        val segs = coreStr.split('.')
        val core = LongArray(3) { idx ->
            segs.getOrNull(idx)?.toLongOrNull() ?: 0L
        }
        return core to pre
    }

    private fun comparePrerelease(a: String, b: String): Int {
        val pa = a.split('.')
        val pb = b.split('.')
        val len = maxOf(pa.size, pb.size)
        for (i in 0 until len) {
            val x = pa.getOrNull(i)
            val y = pb.getOrNull(i)
            if (x == null && y == null) return 0
            if (x == null) return -1
            if (y == null) return 1
            if (x == y) continue
            val nx = x.toLongOrNull()
            val ny = y.toLongOrNull()
            return when {
                nx != null && ny != null -> if (nx > ny) 1 else -1
                nx != null -> -1
                ny != null -> 1
                else -> if (x > y) 1 else -1
            }
        }
        return 0
    }

    /** Returns `> 0` when [a] is newer than [b], `< 0` when older, `0` when equal. */
    fun compareVersions(a: String, b: String): Int {
        val (va, preA) = parseSemver(a)
        val (vb, preB) = parseSemver(b)
        for (i in 0 until 3) {
            if (va[i] != vb[i]) return if (va[i] > vb[i]) 1 else -1
        }
        return when {
            preA == null && preB == null -> 0
            preA == null -> 1 // 2.0.0 > 2.0.0-alpha.1
            preB == null -> -1 // 2.0.0-alpha.1 < 2.0.0
            else -> comparePrerelease(preA, preB)
        }
    }

    fun isOutdated(currentVersion: String, latestVersion: String): Boolean {
        if (latestVersion.isBlank()) return false
        return compareVersions(latestVersion, currentVersion) > 0
    }
}
