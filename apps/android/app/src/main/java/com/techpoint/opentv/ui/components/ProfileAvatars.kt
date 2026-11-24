package com.techpoint.opentv.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.techpoint.opentv.core.model.UserProfile

/**
 * The 24 gradient avatars of OpenTV PC (`apps/desktop/frontend/src/components/Avatars.tsx`,
 * itself v1 `core/profiles.js`), drawn 1:1 from the same 100x100 SVG geometry: same order,
 * colors, faces and indices, so a profile looks identical on PC and on the TV.
 * Paths are parsed once per face and cached; drawing is a handful of Canvas ops (no bitmaps).
 */
data class AvatarDef(val a: Color, val b: Color, val face: String)

val PROFILE_AVATARS: List<AvatarDef> = listOf(
    AvatarDef(Color(0xFF3A7BFF), Color(0xFF8A4DFF), "smile"),
    AvatarDef(Color(0xFFFF5F6D), Color(0xFFFFC371), "cat"),
    AvatarDef(Color(0xFF11998E), Color(0xFF38EF7D), "robot"),
    AvatarDef(Color(0xFFF7B733), Color(0xFFFC4A1A), "star"),
    AvatarDef(Color(0xFFFF6FD8), Color(0xFF3813C2), "bunny"),
    AvatarDef(Color(0xFF00C6FF), Color(0xFF0072FF), "alien"),
    AvatarDef(Color(0xFF232526), Color(0xFF5B5E62), "tv"),
    AvatarDef(Color(0xFFFF9A44), Color(0xFFFC6076), "fox"),
    AvatarDef(Color(0xFF7F53AC), Color(0xFF647DEE), "ghost"),
    AvatarDef(Color(0xFFE52D27), Color(0xFFB31217), "love"),
    AvatarDef(Color(0xFF141E30), Color(0xFF3A6186), "planet"),
    AvatarDef(Color(0xFFA8E063), Color(0xFF56AB2F), "frog"),
    AvatarDef(Color(0xFF8E5A2B), Color(0xFFC48A4A), "bear"),
    AvatarDef(Color(0xFF3E3E46), Color(0xFF8A8A96), "panda"),
    AvatarDef(Color(0xFFB06AB3), Color(0xFF4568DC), "owl"),
    AvatarDef(Color(0xFF1E3C72), Color(0xFF2A5298), "penguin"),
    AvatarDef(Color(0xFF56AB2F), Color(0xFF1D976C), "dino"),
    AvatarDef(Color(0xFFF12711), Color(0xFFF5AF19), "cool"),
    AvatarDef(Color(0xFFEC008C), Color(0xFFFC6767), "wink"),
    AvatarDef(Color(0xFF0F2027), Color(0xFF2C5364), "ninja"),
    AvatarDef(Color(0xFF8E0E00), Color(0xFF1F1C18), "pirate"),
    AvatarDef(Color(0xFFF7971E), Color(0xFFFFD200), "crown"),
    AvatarDef(Color(0xFFE53935), Color(0xFFE35D5B), "popcorn"),
    AvatarDef(Color(0xFF7B4397), Color(0xFFDC2430), "monster"),
)

fun avatarDef(index: Int): AvatarDef = PROFILE_AVATARS[Math.floorMod(index, PROFILE_AVATARS.size)]

/**
 * Avatar index of a profile. Profiles created before indices existed get the same fallback
 * as PC (`useAppStore.ts`: 1st → 0, 2nd → 2, otherwise its position).
 */
fun UserProfile.resolvedAvatarIndex(position: Int = 0): Int = when {
    avatarIndex >= 0 -> avatarIndex
    id == "main" -> 0
    id == "kids" -> 2
    position == 0 -> 0
    position == 1 -> 2
    else -> position
}

/** PC `ProfileAvatar`: rounded square (16 %) or circle when [round]. */
@Composable
fun ProfileAvatar(
    index: Int,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    round: Boolean = false,
) {
    val def = avatarDef(index)
    val ops = remember(def.face) { faceOps(def.face) }
    val bg = remember(def) { Brush.linearGradient(listOf(def.a, def.b), start = Offset.Zero, end = Offset.Infinite) }
    // `size` yields to tight constraints, so callers may also pass fillMaxSize().
    Canvas(modifier.size(size)) {
        val s = this.size.minDimension / 100f
        if (round) {
            drawCircle(bg, radius = this.size.minDimension / 2f)
        } else {
            drawRoundRect(bg, cornerRadius = CornerRadius(18f * s))
        }
        scale(s, s, pivot = Offset.Zero) {
            ops.forEach { it.draw(this) }
        }
    }
}

// ------------------------------------------------------------------ drawing ops (100x100 space)

private val W = Color.White

private sealed interface Op {
    fun draw(d: DrawScope)
}

private class Circ(val cx: Float, val cy: Float, val r: Float, val c: Color = W, val alpha: Float = 1f) : Op {
    override fun draw(d: DrawScope) = d.drawCircle(c, r, Offset(cx, cy), alpha)
}

private class Ell(
    val cx: Float, val cy: Float, val rx: Float, val ry: Float,
    val c: Color = W, val alpha: Float = 1f, val rot: Float = 0f,
    val strokeW: Float = 0f,
) : Op {
    override fun draw(d: DrawScope) {
        val block: DrawScope.() -> Unit = {
            drawOval(
                c, Offset(cx - rx, cy - ry), Size(rx * 2, ry * 2), alpha,
                style = if (strokeW > 0f) Stroke(strokeW) else Fill,
            )
        }
        if (rot != 0f) d.rotate(rot, Offset(cx, cy), block) else d.block()
    }
}

private class Rect(
    val x: Float, val y: Float, val w: Float, val h: Float, val rx: Float,
    val c: Color = W, val alpha: Float = 1f, val strokeW: Float = 0f,
) : Op {
    override fun draw(d: DrawScope) = d.drawRoundRect(
        c, Offset(x, y), Size(w, h), CornerRadius(rx), style = if (strokeW > 0f) Stroke(strokeW) else Fill, alpha = alpha,
    )
}

/** SVG path: filled with [fill] and/or stroked with [stroke] (round caps/joins like the SVGs). */
private class P(
    d: String,
    val fill: Color? = W,
    val stroke: Color? = null,
    val strokeW: Float = 0f,
    val alpha: Float = 1f,
) : Op {
    private val path: Path = PathParser().parsePathString(d).toPath()
    override fun draw(d: DrawScope) {
        if (fill != null) d.drawPath(path, fill, alpha)
        if (stroke != null) {
            d.drawPath(path, stroke, alpha, Stroke(strokeW, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

private fun line(d: String, w: Float, c: Color = W, alpha: Float = 1f) = P(d, fill = null, stroke = c, strokeW = w, alpha = alpha)

private val defaultEyes = listOf(Circ(36f, 44f, 6f), Circ(64f, 44f, 6f))
private val defaultMouth = line("M36 64c8 8 20 8 28 0", 5f)

private val faceCache = HashMap<String, List<Op>>()

private fun faceOps(face: String): List<Op> = synchronized(faceCache) {
    faceCache.getOrPut(face) { buildFace(face) }
}

private fun buildFace(face: String): List<Op> = when (face) {
    "cat" -> listOf(P("M20 30 26 8l14 14M80 30 74 8 60 22", alpha = .9f)) + defaultEyes + defaultMouth
    "robot" -> listOf(
        line("M50 22V10", 4f),
        Circ(50f, 9f, 4f),
        Rect(28f, 38f, 14f, 12f, 3f),
        Rect(58f, 38f, 14f, 12f, 3f),
        Rect(34f, 62f, 32f, 7f, 3.5f),
    )
    "star" -> listOf(P("M50 6l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z", alpha = .95f)) + defaultEyes + defaultMouth
    "bunny" -> listOf(Rect(30f, 2f, 11f, 28f, 5.5f, alpha = .9f), Rect(59f, 2f, 11f, 28f, 5.5f, alpha = .9f)) +
        defaultEyes + defaultMouth
    "alien" -> listOf(
        Ell(34f, 46f, 8f, 10f),
        Ell(66f, 46f, 8f, 10f),
        Circ(50f, 30f, 5f),
        line("M42 68h16", 5f),
    )
    "tv" -> listOf(
        line("M38 12 50 22 62 12", 4f),
        Rect(18f, 24f, 64f, 52f, 10f, strokeW = 4f),
        Circ(38f, 46f, 5f),
        Circ(62f, 46f, 5f),
        line("M40 60c6 5 14 5 20 0", 4f),
    )
    "fox" -> listOf(P("M16 34 22 6l22 18M84 34 78 6 56 24", alpha = .85f), P("M44 58l6 6 6-6z")) + defaultEyes
    "ghost" -> listOf(
        P("M22 88V42a28 28 0 0 1 56 0v46l-9-7-10 7-9-7-10 7-9-7z", alpha = .22f),
        Ell(38f, 44f, 6f, 8f),
        Ell(62f, 44f, 6f, 8f),
        Ell(50f, 64f, 6f, 7f),
    )
    "love" -> listOf(
        P("M36 50l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z"),
        P("M64 50l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z"),
        defaultMouth,
    )
    "planet" -> listOf(
        Ell(50f, 50f, 44f, 12f, alpha = .5f, rot = -18f, strokeW = 3f),
        Circ(80f, 18f, 3f),
        Circ(18f, 80f, 2f),
    ) + defaultEyes + defaultMouth
    "frog" -> listOf(
        Circ(34f, 34f, 10f),
        Circ(66f, 34f, 10f),
        Circ(34f, 34f, 4f, Color(0xFF112233)),
        Circ(66f, 34f, 4f, Color(0xFF112233)),
        line("M28 62c12 10 32 10 44 0", 5f),
    )
    "bear" -> listOf(
        Circ(22f, 20f, 11f, alpha = .85f),
        Circ(78f, 20f, 11f, alpha = .85f),
        Ell(50f, 62f, 15f, 11f, alpha = .3f),
        Ell(50f, 57f, 5f, 4f),
    ) + defaultEyes + line("M43 66c4 4 10 4 14 0", 4f)
    "panda" -> {
        val dark = Color(0xFF111111)
        listOf(
            Circ(20f, 18f, 11f, dark, .6f),
            Circ(80f, 18f, 11f, dark, .6f),
            Ell(34f, 46f, 11f, 13f, dark, .55f, rot = -20f),
            Ell(66f, 46f, 11f, 13f, dark, .55f, rot = 20f),
            Circ(35f, 46f, 4.5f),
            Circ(65f, 46f, 4.5f),
            line("M44 64c3 4 9 4 12 0", 4f),
            Ell(50f, 58f, 5f, 3.5f),
        )
    }
    "owl" -> listOf(
        line("M18 22 30 30M82 22 70 30", 5f),
        Circ(34f, 46f, 13f),
        Circ(66f, 46f, 13f),
        Circ(34f, 46f, 5f, Color(0xFF222222)),
        Circ(66f, 46f, 5f, Color(0xFF222222)),
        P("M44 62l6 9 6-9z", fill = Color(0xFFFFD34D)),
    )
    "penguin" -> listOf(
        Ell(50f, 60f, 28f, 32f, alpha = .92f),
        Circ(40f, 46f, 5f, Color(0xFF1E3C72)),
        Circ(60f, 46f, 5f, Color(0xFF1E3C72)),
        P("M42 56h16l-8 9z", fill = Color(0xFFFFB02E)),
    )
    "dino" -> listOf(
        P("M30 14l6-10 6 10M46 10l6-10 6 10M62 14l6-10 6 10", alpha = .85f),
        Circ(34f, 42f, 6f),
        Circ(66f, 42f, 6f),
        line("M28 62h44", 5f),
        line("M38 62v6M50 62v6M62 62v6", 4f),
    )
    "cool" -> {
        val dark = Color(0xFF111111)
        listOf(
            line("M20 38h60", 5f, dark),
            Rect(22f, 38f, 24f, 14f, 6f, dark),
            Rect(54f, 38f, 24f, 14f, 6f, dark),
            line("M38 66c8 6 18 4 26-4", 5f),
        )
    }
    "wink" -> listOf(
        Circ(36f, 44f, 6f),
        line("M57 45c3-4 11-4 14 0", 5f),
        line("M34 62c10 10 24 10 32 0", 5f),
        P("M58 66c2 6 8 8 10 2", fill = Color(0xFFFF8FB1)),
    )
    "ninja" -> listOf(
        Rect(10f, 32f, 80f, 26f, 6f, Color(0xFF111111), .75f),
        P("M84 40l12-6-6 12", fill = Color(0xFFE52D27)),
        line("M28 46l14 2M58 48l14-2", 6f),
    )
    "pirate" -> {
        val dark = Color(0xFF111111)
        listOf(
            P("M14 30c10-22 62-22 72 0z", fill = dark, alpha = .8f),
            Circ(50f, 20f, 4f),
            P("M20 36 80 50", fill = null, stroke = dark, strokeW = 3f),
            Circ(36f, 46f, 6f),
            Ell(64f, 47f, 9f, 8f, dark),
            line("M38 66c8 4 18 4 24-2", 5f),
        )
    }
    "crown" -> listOf(P("M24 26 30 6l12 12 8-14 8 14 12-12 6 20z", alpha = .95f)) + defaultEyes + defaultMouth
    "popcorn" -> {
        val red = Color(0xFFE53935)
        val corn = Color(0xFFFFF6D5)
        listOf(
            P("M28 44h44l-6 46H34z"),
            P("M38 44l2 46M50 44v46M62 44l-2 46", fill = null, stroke = red, strokeW = 4f),
            Circ(34f, 38f, 9f, corn),
            Circ(50f, 32f, 10f, corn),
            Circ(66f, 38f, 9f, corn),
            Circ(42f, 60f, 3.5f, red),
            Circ(58f, 60f, 3.5f, red),
            line("M44 70c3 3 9 3 12 0", 3.5f, red),
        )
    }
    "monster" -> listOf(
        line("M26 22 18 6M74 22 82 6", 5f),
        Circ(50f, 42f, 14f),
        Circ(50f, 42f, 6f, Color(0xFF222222)),
        line("M30 66h40", 5f),
        P("M36 66l4 8 4-8M56 66l4 8 4-8"),
    )
    else -> defaultEyes + defaultMouth
}
