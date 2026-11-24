package com.techpoint.opentv.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.Key
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.BookmarkAdd
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.techpoint.opentv.R
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.StreamSource
import com.techpoint.opentv.core.model.WatchProgress
import com.techpoint.opentv.core.ranking.SourceRanker
import com.techpoint.opentv.service.RustServiceBridge
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors

@Composable
fun OpenTvImage(
    url: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    targetWidthPx: Int = 340,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val ctx = LocalContext.current
    val resolved = remember(url, targetWidthPx) {
        if (url.isNullOrBlank()) null
        else RustServiceBridge.resizedImageUrl(url, targetWidthPx) ?: url
    }
    if (resolved == null) {
        Box(modifier = modifier.background(OpenTvColors.CardSurface))
        return
    }
    AsyncImage(
        model = remember(resolved) {
            ImageRequest.Builder(ctx)
                .data(resolved)
                .build()
        },
        contentDescription = contentDescription,
        contentScale = contentScale,
        modifier = modifier.background(OpenTvColors.CardSurface),
    )
}

/**
 * Exact OpenTV v1 Poster Card (`inicio.jpg`, `peliculas.jpg`, `ficha.jpg`, `buscador.jpg`):
 * Clean full-art `2:3` poster with `16.dp` radius and no cluttered overlay badges.
 * When a poster is missing, renders the exact v1 dark tile with centered OpenTV TV mark + title.
 */
@Composable
fun PosterCard(
    item: MediaItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = 144.dp,
    showCaptionBelow: Boolean = false,
    showMetaBelow: Boolean = false,
    // Long press (OK held on TV) = remove; a trash badge shows on the focused card.
    onLongClick: (() -> Unit)? = null,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)
    val focusScale = if (focused && ui.isTv) 1.07f else 1f
    val borderColor = if (focused) ui.accent.color else OpenTvColors.GlassBorder
    val borderWidth = if (focused) 3.dp else 1.dp

    Column(
        modifier = modifier
            .width(width)
            .zIndex(if (focused) 10f else 0f)
            .graphicsLayer {
                scaleX = focusScale
                scaleY = focusScale
            }
            // The remote's menu key (☰) does the same as a long press.
            .then(
                if (onLongClick != null) {
                    Modifier.onPreviewKeyEvent { ev ->
                        if (ev.key == Key.Menu && ev.type == KeyEventType.KeyUp) {
                            onLongClick()
                            true
                        } else ev.key == Key.Menu
                    }
                } else Modifier,
            )
            .rememberFocus()
            .combinedClickable(
                interactionSource = interaction,
                indication = null,
                onLongClick = onLongClick,
                onClick = onClick,
            ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(shape)
                .border(borderWidth, borderColor, shape)
                .background(OpenTvColors.CardSurface),
        ) {
            val imgUrl = item.poster.ifBlank { item.backdrop }
            if (imgUrl.isNotBlank()) {
                OpenTvImage(
                    url = imgUrl,
                    contentDescription = item.title,
                    targetWidthPx = if (ui.isTv) 300 else 360,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                // Exact v1 fallback poster tile (`buscador.jpg`)
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
                    modifier = Modifier.fillMaxSize().padding(14.dp),
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.ic_opentv_logo),
                        contentDescription = null,
                        modifier = Modifier.size(34.dp).alpha(0.32f),
                    )
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.labelLarge,
                        color = OpenTvColors.TextSecondary,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (onLongClick != null && focused) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(Color(0xBF000000)),
                ) {
                    Icon(Icons.Rounded.Delete, contentDescription = "Quitar", tint = Color.White, modifier = Modifier.size(13.dp))
                }
            }
        }

        if (showCaptionBelow) {
            Spacer(Modifier.height(7.dp))
            Text(
                text = item.title,
                color = if (focused) Color.White else OpenTvColors.TextSecondary,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (showMetaBelow) {
                val typeLbl = when {
                    item.isAnime -> "Anime"
                    item.isSeries -> "Serie"
                    else -> "Película"
                }
                val sub = listOf(item.year.takeIf { it.isNotBlank() && it != "—" }, typeLbl)
                    .filterNotNull()
                    .joinToString(" · ")
                Text(
                    text = sub,
                    color = OpenTvColors.TextMuted,
                    fontSize = 11.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun ContinueWatchingCard(
    entry: WatchProgress,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = 248.dp,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)
    val scale = if (focused && ui.isTv) 1.05f else 1f

    Column(
        modifier = modifier
            .width(width)
            .zIndex(if (focused) 10f else 0f)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .clip(shape)
                .border(
                    width = if (focused) 3.dp else 1.dp,
                    color = if (focused) ui.accent.color else OpenTvColors.GlassBorder,
                    shape = shape,
                )
                .background(OpenTvColors.CardSurface),
        ) {
            OpenTvImage(
                url = entry.backdrop.ifBlank { entry.poster },
                contentDescription = entry.title,
                targetWidthPx = 460,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.35f to Color.Transparent,
                            1.0f to Color(0xDE0E0E11),
                        ),
                    ),
            )
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(if (focused) ui.accent.color else Color(0xA60E0E11))
                    .border(1.5.dp, Color(0x99FFFFFF), CircleShape),
            ) {
                Icon(
                    imageVector = Icons.Rounded.PlayArrow,
                    contentDescription = "Continuar",
                    tint = if (focused) ui.accent.onAccent else Color.White,
                    modifier = Modifier.size(24.dp),
                )
            }
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 10.dp),
            ) {
                Text(
                    text = entry.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (entry.season > 0 && entry.episode > 0) {
                    Text(
                        text = "T${entry.season} · E${entry.episode}" +
                            if (entry.episodeTitle.isNotBlank()) " · ${entry.episodeTitle}" else "",
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(Color(0x4DFFFFFF)),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(entry.progress.coerceIn(0.03f, 1f))
                        .fillMaxHeight()
                        .background(ui.accent.color),
                )
            }
        }
    }
}

/**
 * Exact replica of OpenTV v1 Hero Banner (`docs/screenshots/inicio.jpg`):
 * - Short kicker (`SERIE` / `PELÍCULA` / `ANIME`)
 * - Bold display title
 * - Line 1 meta: `★ 6.8 · 2022 · Serie`
 * - Line 2 muted genres: `Acción · Aventura · Drama`
 * - 2-line synopsis
 * - `[▶ Reproducir]`, `[ⓘ Más información]`, round `[🔖]` Mi lista + bottom-right pill dots.
 */
@Composable
fun HeroBanner(
    items: List<MediaItem>,
    selectedIndex: Int,
    onSelectIndex: (Int) -> Unit,
    isInMyList: (String) -> Boolean,
    onPlay: (MediaItem) -> Unit,
    onDetails: (MediaItem) -> Unit,
    onToggleList: (MediaItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    val item = items.getOrNull(selectedIndex) ?: items.firstOrNull() ?: return
    val ui = LocalOpenTvUi.current
    val inList = isInMyList(item.id)
    val heroHeight = if (ui.isTv) 388.dp else 435.dp

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(heroHeight)
            .background(OpenTvColors.BgCanvas),
    ) {
        OpenTvImage(
            url = item.backdrop.ifBlank { item.poster },
            contentDescription = item.title,
            targetWidthPx = if (ui.isTv) 1280 else 1080,
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(if (ui.isTv) 0.84f else 1f)
                .align(Alignment.TopEnd),
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        0.0f to OpenTvColors.BgCanvas,
                        0.28f to Color(0xD90E0E11),
                        0.58f to Color(0x380E0E11),
                        0.82f to Color.Transparent,
                    ),
                ),
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.0f to Color(0x880E0E11),
                        0.20f to Color.Transparent,
                        0.66f to Color(0xAA0E0E11),
                        1.0f to OpenTvColors.BgCanvas,
                    ),
                ),
        )

        Column(
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth(if (ui.isTv) 0.62f else 0.94f)
                .padding(
                    start = if (ui.isTv) 28.dp else 18.dp,
                    end = 18.dp,
                    bottom = 24.dp,
                ),
        ) {
            val kindLabel = when {
                item.isAnime -> "ANIME"
                item.isSeries -> "SERIE"
                else -> "PELÍCULA"
            }
            Text(
                text = kindLabel,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.4.sp,
                color = OpenTvColors.TextSecondary,
            )
            val titleSize = when {
                item.title.length > 34 -> 26.sp
                item.title.length > 22 -> 32.sp
                else -> if (ui.isTv) 38.sp else 33.sp
            }
            Text(
                text = item.title,
                fontSize = titleSize,
                lineHeight = titleSize * 1.06f,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-0.6).sp,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            // Line 1 meta: ★ 6.8 · 2022 · 2 h 5 min · Película
            val metaLine = buildList {
                if (item.score.isNotBlank() && item.score != "—") add("★ ${item.score}")
                if (item.year.isNotBlank() && item.year != "—") add(item.year)
                val dur = formatDurationEs(item.duration)
                if (dur.isNotBlank()) add(dur)
                add(if (item.isAnime) "Anime" else if (item.isSeries) "Serie" else "Película")
            }.joinToString(" · ")
            Text(
                text = metaLine,
                color = Color(0xE8FFFFFF),
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
            )

            // Line 2 genres: Acción • Aventura • Drama
            val heroGenres = formatHeroGenres(item.genres, max = 3)
            if (heroGenres.isNotBlank()) {
                Text(
                    text = heroGenres,
                    color = OpenTvColors.TextMuted,
                    fontSize = 12.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (item.synopsis.isNotBlank()) {
                Text(
                    text = item.synopsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xD4FFFFFF),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Spacer(Modifier.height(6.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OpenTvPrimaryButton(
                    text = "Reproducir",
                    icon = Icons.Rounded.PlayArrow,
                    onClick = { onPlay(item) },
                )
                OpenTvGlassButton(
                    text = "Más información",
                    icon = Icons.Rounded.Info,
                    onClick = { onDetails(item) },
                )
                OpenTvRoundIconButton(
                    icon = if (inList) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkAdd,
                    contentDescription = if (inList) "En Mi lista" else "Agregar a Mi lista",
                    selected = inList,
                    onClick = { onToggleList(item) },
                )
            }
        }

        if (items.size > 1) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 22.dp, bottom = 28.dp),
            ) {
                items.take(6).forEachIndexed { idx, _ ->
                    val active = idx == selectedIndex
                    Box(
                        modifier = Modifier
                            .width(if (active) 28.dp else 12.dp)
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp))
                            .background(if (active) ui.accent.color else Color(0x4DFFFFFF))
                            .clickable { onSelectIndex(idx) },
                    )
                }
            }
        }
    }
}

@Composable
fun OpenTvPrimaryButton(
    text: String,
    icon: ImageVector? = null,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .height(44.dp)
            .graphicsLayer {
                if (focused && ui.isTv) {
                    scaleX = 1.05f
                    scaleY = 1.05f
                }
            }
            .clip(shape)
            .background(ui.accent.color)
            .then(if (focused) Modifier.border(3.dp, Color.White, shape) else Modifier)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 20.dp),
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = ui.accent.onAccent,
                modifier = Modifier.size(19.dp),
            )
            Spacer(Modifier.width(7.dp))
        }
        Text(
            text = text,
            color = ui.accent.onAccent,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
            maxLines = 1,
        )
    }
}

@Composable
fun OpenTvGlassButton(
    text: String,
    icon: ImageVector? = null,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)
    val bg = when {
        focused && ui.isTv -> ui.accent.color
        focused -> OpenTvColors.GlassFillFocus
        selected -> OpenTvColors.GlassFillFocus
        else -> Color(0x88383840)
    }
    val fg = if (focused && ui.isTv) ui.accent.onAccent else Color.White

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .height(44.dp)
            .graphicsLayer {
                if (focused && ui.isTv) {
                    scaleX = 1.04f
                    scaleY = 1.04f
                }
            }
            .clip(shape)
            .background(bg)
            .border(
                width = if (focused) 2.5.dp else 1.dp,
                color = if (focused) ui.accent.color else OpenTvColors.GlassBorderStrong,
                shape = shape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 16.dp),
    ) {
        if (icon != null) {
            Icon(imageVector = icon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(7.dp))
        }
        Text(text = text, color = fg, fontWeight = FontWeight.SemiBold, fontSize = 13.5.sp, maxLines = 1)
    }
}

@Composable
fun OpenTvRoundIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    tintOverride: Color? = null,
    size: Dp = 44.dp,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val bg = when {
        focused -> ui.accent.color
        selected -> Color(0x30FFFFFF)
        else -> Color(0x80141418)
    }
    val fg = when {
        focused -> ui.accent.onAccent
        tintOverride != null -> tintOverride
        else -> Color.White
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(bg)
            .border(
                width = if (focused) 2.5.dp else 1.dp,
                color = if (focused) ui.accent.color else Color(0x66FFFFFF),
                shape = CircleShape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Icon(imageVector = icon, contentDescription = contentDescription, tint = fg, modifier = Modifier.size(19.dp))
    }
}

@Composable
fun OpenTvChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    dimmed: Boolean = false,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(999.dp)
    val bg by animateColorAsState(
        when {
            selected -> ui.accent.color
            focused -> OpenTvColors.GlassFillFocus
            else -> OpenTvColors.GlassFill
        },
        label = "chipBg",
    )
    val fg = if (selected) ui.accent.onAccent else Color.White

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .alpha(if (dimmed && !selected && !focused) 0.42f else 1f)
            .height(34.dp)
            .clip(shape)
            .background(bg)
            .border(
                width = if (focused) 2.5.dp else 1.dp,
                color = if (focused) ui.accent.color else if (selected) Color.Transparent else OpenTvColors.GlassBorder,
                shape = shape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 13.dp),
    ) {
        Text(
            text = label,
            color = fg,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            fontSize = 12.5.sp,
            maxLines = 1,
        )
    }
}

/**
 * Exact 1:1 replica of OpenTV v1 "Elegir fuente" modal (`docs/screenshots/fuentes.jpg`):
 * - Row 1: Quality pills with counts (`Todas`, `4K · N`, `Full HD · N`, `HD · N`, `SD · N`) + Type (`Todo`, `Directo`, `Torrent`)
 * - Row 2: `Idioma` pills with counts (`Todos`, `Latino · N`, `Castellano · N`, `Inglés · N`)
 * - Row 3: `Ordenar` (`Recomendado`, `Más pesadas`, `Más ligeras`, `Más semillas`)
 * - Highlighted `Recomendada` top card with mint-green `#7EE2A8` summary line
 * - Bold solid-white left quality badge (`1080p`, `4K`, `720p`) + `⇅` torrent meta prefix
 * - Clean footer (`N fuentes` + `Cancelar`).
 */
@Composable
fun SourcePickerDialog(
    title: String,
    sources: List<StreamSource>,
    loading: Boolean,
    onSelect: (StreamSource) -> Unit,
    onDismiss: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    var qualityFilter by remember { mutableStateOf("all") }
    var typeFilter by remember { mutableStateOf("all") }
    var langFilter by remember { mutableStateOf("all") }
    var sortMode by remember { mutableStateOf("rec") }

    val q4k = remember(sources) { sources.count { it.quality == "4K" } }
    val q1080 = remember(sources) { sources.count { it.quality == "1080p" } }
    val q720 = remember(sources) { sources.count { it.quality == "720p" } }
    val qSd = remember(sources) { sources.count { it.quality == "SD" } }
    val directCount = remember(sources) { sources.count { it.isDirect } }
    val torrentCount = remember(sources) { sources.count { it.isTorrent } }
    val latCount = remember(sources) { sources.count { SourceRanker.hasLang(it, "latino") || SourceRanker.hasLang(it, "es") } }
    val castCount = remember(sources) { sources.count { SourceRanker.hasLang(it, "castellano") } }
    val enCount = remember(sources) { sources.count { SourceRanker.hasLang(it, "en") } }

    val filtered = remember(sources, qualityFilter, typeFilter, langFilter, sortMode) {
        sources.filter { s ->
            val qOk = qualityFilter == "all" || s.quality == qualityFilter
            val tOk = when (typeFilter) {
                "direct" -> s.isDirect
                "torrent" -> s.isTorrent
                else -> true
            }
            val lOk = when (langFilter) {
                "latino" -> SourceRanker.hasLang(s, "latino") || SourceRanker.hasLang(s, "es")
                "castellano" -> SourceRanker.hasLang(s, "castellano")
                "en" -> SourceRanker.hasLang(s, "en")
                else -> true
            }
            qOk && tOk && lOk
        }.let { list ->
            when (sortMode) {
                "heavy" -> list.sortedByDescending { it.sizeBytes }
                "light" -> list.sortedBy { if (it.sizeBytes > 0L) it.sizeBytes else Long.MAX_VALUE }
                "seeds" -> list.sortedByDescending { it.seeders }
                else -> list
            }
        }
    }

    val recommended = filtered.firstOrNull()
    val others = if (filtered.size > 1) filtered.drop(1) else emptyList()

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            color = Color(0xF5111114),
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
            modifier = Modifier
                .fillMaxWidth(if (ui.isTv) 0.78f else 0.95f)
                .fillMaxHeight(0.86f),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Header + Filter chips (`srcp-head`)
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Elegir fuente", style = MaterialTheme.typography.headlineMedium)
                            Text(title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        OpenTvRoundIconButton(Icons.Rounded.Close, "Cerrar", onDismiss, size = 36.dp)
                    }

                    // Row 1: Quality + Type
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        item { OpenTvChip("Todas", qualityFilter == "all", { qualityFilter = "all" }) }
                        item { OpenTvChip("4K · $q4k", qualityFilter == "4K", { qualityFilter = "4K" }, dimmed = q4k == 0) }
                        item { OpenTvChip("Full HD · $q1080", qualityFilter == "1080p", { qualityFilter = "1080p" }, dimmed = q1080 == 0) }
                        item { OpenTvChip("HD · $q720", qualityFilter == "720p", { qualityFilter = "720p" }, dimmed = q720 == 0) }
                        item { OpenTvChip("SD · $qSd", qualityFilter == "SD", { qualityFilter = "SD" }, dimmed = qSd == 0) }
                        item { Spacer(Modifier.width(8.dp)) }
                        item { OpenTvChip("Todo", typeFilter == "all", { typeFilter = "all" }) }
                        item { OpenTvChip("Directo · $directCount", typeFilter == "direct", { typeFilter = "direct" }, dimmed = directCount == 0) }
                        item { OpenTvChip("Torrent · $torrentCount", typeFilter == "torrent", { typeFilter = "torrent" }, dimmed = torrentCount == 0) }
                    }

                    // Row 2: Idioma
                    LazyRow(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        item { Text("Idioma", color = OpenTvColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(end = 4.dp)) }
                        item { OpenTvChip("Todos", langFilter == "all", { langFilter = "all" }) }
                        item { OpenTvChip("Latino · $latCount", langFilter == "latino", { langFilter = "latino" }, dimmed = latCount == 0) }
                        item { OpenTvChip("Castellano · $castCount", langFilter == "castellano", { langFilter = "castellano" }, dimmed = castCount == 0) }
                        item { OpenTvChip("Inglés · $enCount", langFilter == "en", { langFilter = "en" }, dimmed = enCount == 0) }
                    }

                    // Row 3: Ordenar
                    LazyRow(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        item { Text("Ordenar", color = OpenTvColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(end = 4.dp)) }
                        item { OpenTvChip("Recomendado", sortMode == "rec", { sortMode = "rec" }) }
                        item { OpenTvChip("Más pesadas", sortMode == "heavy", { sortMode = "heavy" }) }
                        item { OpenTvChip("Más ligeras", sortMode == "light", { sortMode = "light" }) }
                        item { OpenTvChip("Más semillas", sortMode == "seeds", { sortMode = "seeds" }) }
                    }
                }

                HorizontalDivider(color = OpenTvColors.SubtleDivider)

                // Body (`srcp-body`)
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    when {
                        loading && sources.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Buscando fuentes en tus plugins…", style = MaterialTheme.typography.bodyLarge)
                        }
                        filtered.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("No hay fuentes con esos filtros.", style = MaterialTheme.typography.bodyLarge)
                        }
                        else -> LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                        ) {
                            if (recommended != null) {
                                item(key = "hdr_rec") {
                                    Row(
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
                                    ) {
                                        Text("Recomendada", style = MaterialTheme.typography.titleMedium)
                                        Text(recommended.addonName, style = MaterialTheme.typography.labelMedium)
                                    }
                                }
                                item(key = "rec_${recommended.id}") {
                                    V1SourceRow(source = recommended, isRecommended = true, onClick = { onSelect(recommended) })
                                }
                            }
                            if (others.isNotEmpty()) {
                                item(key = "hdr_all") {
                                    Row(
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        modifier = Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 10.dp, bottom = 4.dp),
                                    ) {
                                        Text("Todas las fuentes", style = MaterialTheme.typography.titleMedium)
                                        Text("${filtered.size} fuentes", style = MaterialTheme.typography.labelMedium)
                                    }
                                }
                                items(others, key = { it.id }) { src ->
                                    V1SourceRow(source = src, isRecommended = false, onClick = { onSelect(src) })
                                }
                            }
                        }
                    }
                }

                HorizontalDivider(color = OpenTvColors.SubtleDivider)

                // Footer (`srcp-foot`)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                ) {
                    Text("${filtered.size} fuentes", style = MaterialTheme.typography.labelMedium)
                    OpenTvGlassButton(text = "Cancelar", onClick = onDismiss)
                }
            }
        }
    }
}

@Composable
private fun V1SourceRow(
    source: StreamSource,
    isRecommended: Boolean,
    onClick: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(12.dp)

    val qualityText = when (source.quality) {
        "4K" -> "4K"
        "1080p" -> "1080p"
        "720p" -> "720p"
        "SD" -> "SD"
        // Unknown = adaptive/undetected (most plugin HLS streams); the player picks the rendition.
        else -> "Auto"
    }
    val hasQuality = source.quality != "unknown"

    val metaParts = buildList {
        val lang = SourceRanker.languageSummary(source)
        add(lang.ifBlank { "Idioma original" })
        add(if (source.isDirect) "Directo" else "Torrent")
        val size = SourceRanker.formatSize(source.sizeBytes)
        if (size.isNotBlank()) add(size)
        if (source.isTorrent && source.seeders > 0) add("${source.seeders} semillas")
        add(source.addonName)
    }
    val metaLine = (if (source.isTorrent) "⇅ " else "") + metaParts.joinToString(" · ")

    val displayName = source.filename.ifBlank {
        source.title.lineSequence().firstOrNull()?.trim().orEmpty()
    }.ifBlank { source.name.replace('\n', ' ').trim() }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(
                when {
                    focused -> Color(0x20FFFFFF)
                    isRecommended -> Color(0x147EE2A8)
                    else -> Color.Transparent
                },
            )
            .then(
                when {
                    focused -> Modifier.border(2.dp, ui.accent.color, shape)
                    isRecommended -> Modifier.border(1.dp, Color(0x4D7EE2A8), shape)
                    else -> Modifier
                },
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
    ) {
        // Signature OpenTV v1 white quality pill box (`.srcp-q`)
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .width(64.dp)
                .height(34.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(if (hasQuality) Color.White else Color(0x1AFFFFFF)),
        ) {
            Text(
                text = qualityText,
                color = if (hasQuality) OpenTvColors.BgCanvas else OpenTvColors.TextSecondary,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 13.sp,
            )
        }

        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = displayName,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = metaLine,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (isRecommended) {
                val recSummary = buildList {
                    val lang = SourceRanker.languageSummary(source)
                    if (lang.isNotBlank()) add(lang)
                    add(if (source.quality == "1080p") "Full HD" else qualityText)
                    if (source.isHdr) add("HDR")
                    if (source.isAtmos) add("Dolby Atmos")
                    if (source.seeders > 0) add("${source.seeders} semillas")
                    val sz = SourceRanker.formatSize(source.sizeBytes)
                    if (sz.isNotBlank()) add(sz)
                }.joinToString(" · ")
                Text(
                    text = recSummary,
                    color = OpenTvColors.MintGreen,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
