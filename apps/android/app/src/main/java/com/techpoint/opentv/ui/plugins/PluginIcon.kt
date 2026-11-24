package com.techpoint.opentv.ui.plugins

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ClosedCaption
import androidx.compose.material.icons.rounded.Eco
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.LocalMovies
import androidx.compose.material.icons.rounded.Newspaper
import androidx.compose.material.icons.rounded.PlayCircleOutline
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.SportsSoccer
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Theaters
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.techpoint.opentv.core.addons.PluginCatalogs

/**
 * Renders a plugin's official manifest logo when available, falling back seamlessly
 * to crisp, distinct custom brand/category badges kept in 1:1 parity with OpenTV PC (`PluginIcon.tsx`).
 * Lightweight (zero animations / zero blur) for smooth 1 GB Fire TV rendering.
 */
@Composable
fun PluginIcon(
    name: String,
    modifier: Modifier = Modifier,
    id: String = "",
    url: String = "",
    logo: String = "",
    kind: String = "stremio",
    category: String = "",
    hasStream: Boolean = false,
    hasCatalog: Boolean = false,
    hasSubtitles: Boolean = false,
    dimmed: Boolean = false,
    size: Dp = 32.dp,
    cornerRadius: Dp = 8.5.dp,
) {
    val effectiveLogo = remember(logo, url) {
        val raw = logo.trim().ifBlank { PluginCatalogs.knownLogoFor(url) }
        if (raw.substringBefore("?").endsWith(".svg", ignoreCase = true)) "" else raw
    }
    var imgFailed by remember(effectiveLogo) { mutableStateOf(false) }

    val shape = RoundedCornerShape(cornerRadius)
    val baseMod = modifier
        .size(size)
        .alpha(if (dimmed) 0.5f else 1f)
        .clip(shape)

    if (effectiveLogo.isNotBlank() && !imgFailed) {
        val context = LocalContext.current
        val req = remember(effectiveLogo) {
            ImageRequest.Builder(context)
                .data(effectiveLogo)
                .size(96)
                .build()
        }
        Box(
            contentAlignment = Alignment.Center,
            modifier = baseMod
                .background(Color(0xFF1D1D24))
                .border(0.5.dp, Color(0x1AFFFFFF), shape)
                .padding(size * 0.11f),
        ) {
            AsyncImage(
                model = req,
                contentDescription = name,
                contentScale = ContentScale.Fit,
                onError = { imgFailed = true },
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape((cornerRadius.value * 0.65f).dp)),
            )
        }
        return
    }

    val key = remember(id, name, url, category) {
        "$id $name $url $category".lowercase()
    }
    val iconSize = size * 0.56f
    val scale = size.value / 32f

    when {
        // 1. Cinemeta (official Stremio purple film-clapper badge)
        "cinemeta" in key -> GradientBadge(
            colors = listOf(Color(0xFF6366F1), Color(0xFF8B5CF6)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.LocalMovies, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 2. Anime Kitsu (coral-orange fox silhouette)
        "kitsu" in key || "anime" in key -> GradientBadge(
            colors = listOf(Color(0xFFF97316), Color(0xFFEA580C)),
            modifier = baseMod,
        ) {
            Canvas(Modifier.size(size * 0.68f)) {
                val w = this.size.width
                val h = this.size.height
                val head = Path().apply {
                    moveTo(w * 0.14f, h * 0.16f)
                    lineTo(w * 0.40f, h * 0.34f)
                    lineTo(w * 0.50f, h * 0.27f)
                    lineTo(w * 0.60f, h * 0.34f)
                    lineTo(w * 0.86f, h * 0.16f)
                    lineTo(w * 0.86f, h * 0.56f)
                    cubicTo(w * 0.86f, h * 0.78f, w * 0.70f, h * 0.88f, w * 0.50f, h * 0.88f)
                    cubicTo(w * 0.30f, h * 0.88f, w * 0.14f, h * 0.78f, w * 0.14f, h * 0.56f)
                    close()
                }
                drawPath(head, color = Color.White)
                val eyeR = w * 0.065f
                drawCircle(Color(0xFFEA580C), radius = eyeR, center = Offset(w * 0.36f, h * 0.58f))
                drawCircle(Color(0xFFEA580C), radius = eyeR, center = Offset(w * 0.64f, h * 0.58f))
            }
        }

        // 3. OpenSubtitles / Subtitles Website (emerald-teal CC badge)
        "opensubtitles" in key || "subtit" in key || hasSubtitles || category == "subtitulos" -> GradientBadge(
            colors = listOf(Color(0xFF10B981), Color(0xFF0D9488)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.ClosedCaption, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 4. TorrentsDB (vibrant violet T monogram badge — avoids SVG dependency on Coil)
        "torrentsdb" in key -> GradientBadge(
            colors = listOf(Color(0xFF7C3AED), Color(0xFF4F46E5)),
            modifier = baseMod,
        ) {
            Text(
                text = "T",
                color = Color.White,
                fontSize = (16f * scale).sp,
                fontWeight = FontWeight.Black,
            )
        }

        // 5. Pluto TV (dark + yellow/cyan/magenta orbital brand dots + "pluto")
        "pluto" in key -> Box(
            contentAlignment = Alignment.Center,
            modifier = baseMod
                .background(Brush.linearGradient(listOf(Color(0xFF17171D), Color(0xFF0B0B0F))))
                .border(0.75.dp, Color(0x4DFACC15), shape),
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy((1.5f * scale).dp),
            ) {
                Canvas(Modifier.size(width = (22f * scale).dp, height = (8f * scale).dp)) {
                    val w = this.size.width
                    val h = this.size.height
                    val r = h * 0.36f
                    drawCircle(Color(0xFFFACC15), radius = r, center = Offset(w * 0.18f, h * 0.62f))
                    drawCircle(Color(0xFF38BDF8), radius = r * 1.12f, center = Offset(w * 0.50f, h * 0.38f))
                    drawCircle(Color(0xFFFB7185), radius = r, center = Offset(w * 0.82f, h * 0.62f))
                }
                Text(
                    text = "pluto",
                    color = Color.White,
                    fontSize = (8.2f * scale).sp,
                    fontWeight = FontWeight.ExtraBold,
                    lineHeight = (8.5f * scale).sp,
                )
            }
        }

        // 6. Plex TV (dark charcoal + signature golden Plex chevron)
        "plex" in key -> Box(
            contentAlignment = Alignment.Center,
            modifier = baseMod
                .background(Brush.linearGradient(listOf(Color(0xFF1F1E1A), Color(0xFF121214))))
                .border(0.75.dp, Color(0x59E5A00D), shape),
        ) {
            Canvas(Modifier.size(size * 0.58f)) {
                val w = this.size.width
                val h = this.size.height
                val chevron = Path().apply {
                    moveTo(w * 0.22f, h * 0.10f)
                    lineTo(w * 0.52f, h * 0.10f)
                    lineTo(w * 0.82f, h * 0.50f)
                    lineTo(w * 0.52f, h * 0.90f)
                    lineTo(w * 0.22f, h * 0.90f)
                    lineTo(w * 0.52f, h * 0.50f)
                    close()
                }
                drawPath(chevron, color = Color(0xFFE5A00D))
            }
        }

        // 7. Samsung TV Plus (royal Samsung blue + crisp TV+)
        "samsung" in key -> GradientBadge(
            colors = listOf(Color(0xFF1428A0), Color(0xFF2563EB)),
            modifier = baseMod,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "TV",
                    color = Color.White,
                    fontSize = (10.5f * scale).sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = (-0.4).sp,
                )
                Text(
                    text = "+",
                    color = Color(0xFF60A5FA),
                    fontSize = (11.5f * scale).sp,
                    fontWeight = FontWeight.Black,
                )
            }
        }

        // 8. TDTChannels España (cyan-teal broadcast arcs + TDT)
        "tdt" in key -> GradientBadge(
            colors = listOf(Color(0xFF0E7490), Color(0xFF06B6D4)),
            modifier = baseMod,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy((0.5f * scale).dp),
            ) {
                Canvas(Modifier.size(width = (16f * scale).dp, height = (6.5f * scale).dp)) {
                    val stroke = Stroke(width = 1.4f * scale, cap = StrokeCap.Round)
                    drawArc(
                        color = Color(0xCCFFFFFF),
                        startAngle = 215f,
                        sweepAngle = 110f,
                        useCenter = false,
                        style = stroke,
                    )
                }
                Text(
                    text = "TDT",
                    color = Color.White,
                    fontSize = (9.5f * scale).sp,
                    fontWeight = FontWeight.ExtraBold,
                    lineHeight = (10f * scale).sp,
                )
            }
        }

        // 9. DeepFlix (crimson-violet DF badge)
        "deepflix" in key -> GradientBadge(
            colors = listOf(Color(0xFFE11D48), Color(0xFF7C3AED)),
            modifier = baseMod,
        ) {
            Text(
                text = "DF",
                color = Color.White,
                fontSize = (12f * scale).sp,
                fontWeight = FontWeight.Black,
            )
        }

        // 10. Deportes en Vivo (emerald soccer ball)
        category == "deportes" || "sport" in key || "deport" in key -> GradientBadge(
            colors = listOf(Color(0xFF16A34A), Color(0xFF059669)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.SportsSoccer, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 11. Noticias 24 Horas (red-coral news badge)
        category == "noticias" || "news" in key || "notic" in key -> GradientBadge(
            colors = listOf(Color(0xFFDC2626), Color(0xFFEA580C)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.Newspaper, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 12. Infantil y Caricaturas (warm gold-pink star badge)
        category == "infantil" || "kids" in key || "infantil" in key -> GradientBadge(
            colors = listOf(Color(0xFFF59E0B), Color(0xFFEC4899)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.Star, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 13. Documentales y Naturaleza (teal-forest eco badge)
        category == "documentales" || "document" in key -> GradientBadge(
            colors = listOf(Color(0xFF0D9488), Color(0xFF15803D)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.Eco, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 14. Cine y Series 24/7 / Catálogos (amber-crimson film badge)
        category == "cine" || category == "catalogos" || "movies_iptv" in key || hasCatalog -> GradientBadge(
            colors = listOf(Color(0xFFD97706), Color(0xFFB91C1C)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.Theaters, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 15. México (tricolor accent broadcast emblem)
        id == "m3u_mx" || id == "mx" || "méxico (canales" in key -> GradientBadge(
            colors = listOf(Color(0xFF15803D), Color(0xFF1E293B), Color(0xFFDC2626)),
            modifier = baseMod,
        ) {
            Text(
                text = "MX",
                color = Color.White,
                fontSize = (11.5f * scale).sp,
                fontWeight = FontWeight.ExtraBold,
            )
        }

        // 16. TV por país / TV Abierta Hispana (indigo-sky globe)
        category == "paises" || "latam" in key || "hispana" in key -> GradientBadge(
            colors = listOf(Color(0xFF2563EB), Color(0xFF4F46E5)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.Public, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 17. Generic M3U / TV gratis
        kind == "m3u" || category == "gratis" -> GradientBadge(
            colors = listOf(Color(0xFF0284C7), Color(0xFF4F46E5)),
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.LiveTv, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }

        // 18. Stream / Torrent / Direct Source fallback
        else -> GradientBadge(
            colors = if (hasStream || category == "torrents" || category == "directas") {
                listOf(Color(0xFF7C3AED), Color(0xFF2563EB))
            } else {
                listOf(Color(0xFF3F3F46), Color(0xFF27272A))
            },
            modifier = baseMod,
        ) {
            Icon(Icons.Rounded.PlayCircleOutline, null, tint = Color.White, modifier = Modifier.size(iconSize))
        }
    }
}

@Composable
private fun GradientBadge(
    colors: List<Color>,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.background(Brush.linearGradient(colors)),
    ) {
        content()
    }
}
