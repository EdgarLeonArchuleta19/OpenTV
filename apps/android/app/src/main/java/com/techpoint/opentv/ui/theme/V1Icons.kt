package com.techpoint.opentv.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * OpenTV v1 line icons (24-unit viewBox, stroke 2, round caps/joins) from
 * `ui/js/src/core/config.js` (TV rail) and `core/icons.js` (top bar).
 */
object V1Icons {
    private fun rect(x: Float, y: Float, w: Float, h: Float, rx: Float = 0f): String {
        if (rx <= 0f) return "M$x ${y}H${x + w}V${y + h}H${x}Z"
        return "M${x + rx} ${y}H${x + w - rx}A$rx $rx 0 0 1 ${x + w} ${y + rx}" +
            "V${y + h - rx}A$rx $rx 0 0 1 ${x + w - rx} ${y + h}" +
            "H${x + rx}A$rx $rx 0 0 1 $x ${y + h - rx}" +
            "V${y + rx}A$rx $rx 0 0 1 ${x + rx} ${y}Z"
    }

    private fun circle(cx: Float, cy: Float, r: Float): String =
        "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0"

    private fun line(name: String, vararg paths: String, viewport: Float = 24f, stroke: Float = 2f): ImageVector {
        val b = ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = viewport,
            viewportHeight = viewport,
        )
        paths.forEach { d ->
            b.addPath(
                pathData = PathParser().parsePathString(d).toNodes(),
                fill = null,
                stroke = SolidColor(Color.White),
                strokeLineWidth = stroke,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return b.build()
    }

    val Tv: ImageVector by lazy { line("tv", rect(2.5f, 5f, 19f, 13f, 2f), "M8 21h8") }
    val Home: ImageVector by lazy {
        line("home", "M3.5 10.5 12 3.5l8.5 7", "M5.5 9v11h13V9", "M10 20v-6h4v6")
    }
    val Film: ImageVector by lazy {
        line(
            "film",
            rect(3f, 3.5f, 18f, 17f, 2f),
            "M7.5 3.5v17M16.5 3.5v17M3 8h4.5M3 12h4.5M3 16h4.5M16.5 8H21M16.5 12H21M16.5 16H21",
        )
    }
    val Series: ImageVector by lazy { line("series", rect(2.5f, 6.5f, 19f, 13f, 2f), "M8 2.5l4 4 4-4") }
    val Kids: ImageVector by lazy {
        line(
            "kids",
            circle(12f, 13f, 7.5f),
            circle(6f, 5.5f, 2.5f),
            circle(18f, 5.5f, 2.5f),
            "M9.5 15.5c1.4 1.3 3.6 1.3 5 0",
            "M9.5 11h.01M14.5 11h.01",
        )
    }
    val Anime: ImageVector by lazy {
        line("anime", "M12 3l2.4 5.6 6.1.6-4.6 4 1.4 6-5.3-3.2L6.7 19.2l1.4-6-4.6-4 6.1-.6z")
    }
    val Search: ImageVector by lazy { line("search", circle(11f, 11f, 7f), "m20 20-3.5-3.5") }
    val MyList: ImageVector by lazy { line("mylist", "M6 3.5h12v17l-6-4-6 4z", "M12 7.5v5M9.5 10h5") }
}
