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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.KeyboardArrowDown
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
    // Fill behind the picture; logos with transparency pass Color.Transparent so they keep
    // their tile color (the card surface is white in the light theme).
    background: Color = OpenTvColors.CardSurface,
) {
    val ctx = LocalContext.current
    val widthPx = liteWidth(targetWidthPx, LocalOpenTvUi.current.liteMode)
    val resolved = remember(url, widthPx) {
        if (url.isNullOrBlank()) null
        else RustServiceBridge.resizedImageUrl(url, widthPx) ?: url
    }
    if (resolved == null) {
        Box(modifier = modifier.background(background))
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
        modifier = modifier.background(background),
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
                        colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(OpenTvColors.Content),
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
                color = if (focused) OpenTvColors.Content else OpenTvColors.TextSecondary,
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
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (entry.season > 0 && entry.episode > 0) {
                    Text(
                        text = "T${entry.season} · E${entry.episode}" +
                            if (entry.episodeTitle.isNotBlank()) " · ${entry.episodeTitle}" else "",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color(0xB8FFFFFF),
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
    val heroBg = OpenTvColors.BgCanvas

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(heroHeight)
            .background(OpenTvColors.BgCanvas),
    ) {
        OpenTvImage(
            // Lite mode: the hero keeps its text and buttons, without the big artwork.
            url = if (ui.liteMode) null else item.backdrop.ifBlank { item.poster },
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
                        0.0f to heroBg,
                        0.28f to heroBg.copy(alpha = 0xD9 / 255f),
                        0.58f to heroBg.copy(alpha = 0x38 / 255f),
                        0.82f to Color.Transparent,
                    ),
                ),
        )
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.0f to heroBg.copy(alpha = 0x88 / 255f),
                        0.20f to Color.Transparent,
                        0.66f to heroBg.copy(alpha = 0xAA / 255f),
                        1.0f to heroBg,
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
                color = OpenTvColors.Content,
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
                color = OpenTvColors.fg(0xE8 / 255f),
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
                    color = OpenTvColors.fg(0xD4 / 255f),
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
                            .background(if (active) ui.accent.color else OpenTvColors.Content.copy(alpha = 0.3f))
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
            .then(if (focused) Modifier.border(3.dp, OpenTvColors.FocusRing, shape) else Modifier)
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
        else -> if (OpenTvColors.isLight) OpenTvColors.fg(0.07f) else Color(0x88383840)
    }
    val fg = if (focused && ui.isTv) ui.accent.onAccent else OpenTvColors.Content

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
        selected -> OpenTvColors.Content.copy(alpha = 0x30 / 255f)
        else -> if (OpenTvColors.isLight) OpenTvColors.CardSurface else Color(0x80141418)
    }
    val fg = when {
        focused -> ui.accent.onAccent
        tintOverride != null -> tintOverride
        else -> OpenTvColors.Content
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(bg)
            .border(
                width = if (focused) 2.5.dp else 1.dp,
                color = if (focused) ui.accent.color else OpenTvColors.Content.copy(alpha = 0.4f),
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
    val fg = if (selected) ui.accent.onAccent else OpenTvColors.Content

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
 * "Elegir fuente": simple list for everyone, same design as the PC `SourcePickerModal`.
 * - Three dropdown filters (`Calidad`, `Idioma`, `Tipo`) that only list values present.
 * - The ranker's best pick on top, marked `Recomendada` (mint `#7EE2A8`).
 * - One plain row per source: quality badge, language in Spanish, Directo/Torrent, size, plugin.
 * On TV focus starts on the recommended row; each dropdown opens a small D-pad list
 * (focus on the current value, Back closes it and focus returns to the button). No blur.
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
    var langFilter by remember { mutableStateOf("all") }
    var typeFilter by remember { mutableStateOf("all") }

    val options = remember(sources) { SourceRanker.pickerFilterOptions(sources) }
    val filtered = remember(sources, qualityFilter, langFilter, typeFilter) {
        sources.filter { s ->
            SourceRanker.matchesQualityFilter(s, qualityFilter) &&
                SourceRanker.matchesLangFilter(s, langFilter) &&
                SourceRanker.matchesTypeFilter(s, typeFilter)
        }
            // Rows are keyed by id: two installs of the same plugin can yield the same id.
            .distinctBy { it.id }
    }
    val recommended = filtered.firstOrNull()
    val others = if (filtered.size > 1) filtered.drop(1) else emptyList()
    val anyFilter = qualityFilter != "all" || langFilter != "all" || typeFilter != "all"

    // TV: land on the recommended source once, so OK plays the best pick right away.
    val recFocus = remember { FocusRequester() }
    var initialFocusDone by remember { mutableStateOf(false) }
    LaunchedEffect(recommended != null) {
        if (ui.isTv && recommended != null && !initialFocusDone) {
            initialFocusDone = true
            withFrameNanos { }
            runCatching { recFocus.requestFocus() }
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            color = if (OpenTvColors.isLight) OpenTvColors.Sheet else Color(0xF5111114),
            shape = RoundedCornerShape(20.dp),
            border = BorderStroke(1.dp, OpenTvColors.GlassBorderStrong),
            modifier = Modifier
                .fillMaxWidth(if (ui.isTv) 0.74f else 0.95f)
                .fillMaxHeight(0.86f),
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Header + dropdown filters
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
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

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    ) {
                        PickerSelect("Calidad", qualityFilter, options.quality, { qualityFilter = it })
                        PickerSelect("Idioma", langFilter, options.lang, { langFilter = it })
                        PickerSelect("Tipo", typeFilter, options.type, { typeFilter = it })
                        if (anyFilter) {
                            OpenTvGlassButton(
                                text = "Quitar filtros",
                                onClick = {
                                    qualityFilter = "all"
                                    langFilter = "all"
                                    typeFilter = "all"
                                },
                            )
                        }
                    }
                }

                HorizontalDivider(color = OpenTvColors.SubtleDivider)

                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    when {
                        loading && sources.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Buscando fuentes en tus plugins…", style = MaterialTheme.typography.bodyLarge)
                        }
                        filtered.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                if (sources.isEmpty()) "No se encontraron fuentes." else "No hay fuentes con esos filtros.",
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                        else -> LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
                        ) {
                            if (recommended != null) {
                                item(key = "rec_${recommended.id}") {
                                    PickerSourceRow(
                                        source = recommended,
                                        isRecommended = true,
                                        onClick = { onSelect(recommended) },
                                        modifier = Modifier.focusRequester(recFocus),
                                    )
                                }
                            }
                            if (others.isNotEmpty()) {
                                item(key = "hdr_more") {
                                    Row(
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 10.dp, bottom = 2.dp),
                                    ) {
                                        Text("Más opciones", style = MaterialTheme.typography.titleMedium)
                                        Text(
                                            "${others.size} ${if (others.size == 1) "fuente" else "fuentes"}",
                                            style = MaterialTheme.typography.labelMedium,
                                        )
                                    }
                                }
                                items(others, key = { it.id }) { src ->
                                    PickerSourceRow(source = src, isRecommended = false, onClick = { onSelect(src) })
                                }
                            }
                        }
                    }
                }

                HorizontalDivider(color = OpenTvColors.SubtleDivider)

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                ) {
                    val count = "${filtered.size} ${if (filtered.size == 1) "fuente" else "fuentes"}"
                    Text(
                        if (loading && sources.isNotEmpty()) "$count · buscando más…" else count,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    OpenTvGlassButton(text = "Cancelar", onClick = onDismiss)
                }
            }
        }
    }
}

/** Filter dropdown: a focusable button that opens a small list anchored below it. */
@Composable
private fun PickerSelect(
    label: String,
    value: String,
    options: List<SourceRanker.PickerOption>,
    onChange: (String) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    var open by remember { mutableStateOf(false) }
    var wasOpen by remember { mutableStateOf(false) }
    val buttonFocus = remember { FocusRequester() }
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val current = options.firstOrNull { it.value == value } ?: options.firstOrNull()
    val shape = RoundedCornerShape(12.dp)
    val density = LocalDensity.current

    // Focus goes back to the button once the list closes (pick or Back).
    LaunchedEffect(open) {
        if (open) {
            wasOpen = true
        } else if (wasOpen) {
            withFrameNanos { }
            runCatching { buttonFocus.requestFocus() }
        }
    }

    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .height(44.dp)
                .widthIn(min = 140.dp)
                .clip(shape)
                .background(if (focused || open) OpenTvColors.GlassFillFocus else OpenTvColors.GlassFill)
                .border(
                    width = if (focused) 2.5.dp else 1.dp,
                    color = if (focused || open || value != "all") ui.accent.color else OpenTvColors.GlassBorder,
                    shape = shape,
                )
                .focusRequester(buttonFocus)
                .clickable(interactionSource = interaction, indication = null) { open = true }
                .padding(horizontal = 14.dp),
        ) {
            Text(label, color = OpenTvColors.TextMuted, fontSize = 12.5.sp, maxLines = 1)
            Text(
                current?.label.orEmpty(),
                color = OpenTvColors.Content,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                maxLines = 1,
                modifier = Modifier.weight(1f, fill = false),
            )
            Icon(
                Icons.Rounded.KeyboardArrowDown,
                contentDescription = null,
                tint = OpenTvColors.TextSecondary,
                modifier = Modifier.size(18.dp),
            )
        }
        if (open) {
            Popup(
                alignment = Alignment.TopStart,
                offset = IntOffset(0, with(density) { 50.dp.roundToPx() }),
                onDismissRequest = { open = false },
                properties = PopupProperties(focusable = true),
            ) {
                PickerOptionList(
                    options = options,
                    value = value,
                    onPick = {
                        onChange(it)
                        open = false
                    },
                )
            }
        }
    }
}

@Composable
private fun PickerOptionList(
    options: List<SourceRanker.PickerOption>,
    value: String,
    onPick: (String) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val selectedFocus = remember { FocusRequester() }
    val shape = RoundedCornerShape(12.dp)
    LaunchedEffect(Unit) {
        withFrameNanos { }
        runCatching { selectedFocus.requestFocus() }
    }
    Column(
        modifier = Modifier
            .widthIn(min = 200.dp, max = 320.dp)
            .heightIn(max = 300.dp)
            .clip(shape)
            .background(if (OpenTvColors.isLight) OpenTvColors.Sheet else Color(0xFF1B1B20))
            .border(1.dp, OpenTvColors.GlassBorderStrong, shape)
            .verticalScroll(rememberScrollState())
            .padding(4.dp),
    ) {
        options.forEach { o ->
            val selected = o.value == value
            val interaction = remember(o.value) { MutableInteractionSource() }
            val focused by interaction.collectIsFocusedAsState()
            val itemShape = RoundedCornerShape(9.dp)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .clip(itemShape)
                    .background(if (focused) OpenTvColors.GlassFillFocus else Color.Transparent)
                    .then(if (focused) Modifier.border(2.dp, ui.accent.color, itemShape) else Modifier)
                    .then(if (selected) Modifier.focusRequester(selectedFocus) else Modifier)
                    .clickable(interactionSource = interaction, indication = null) { onPick(o.value) }
                    .padding(horizontal = 12.dp),
            ) {
                Icon(
                    Icons.Rounded.Check,
                    contentDescription = null,
                    tint = if (selected) ui.accent.color else Color.Transparent,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    o.label,
                    color = if (selected) OpenTvColors.Content else OpenTvColors.TextSecondary,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 14.sp,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                Text("${o.count}", color = OpenTvColors.TextSubtle, fontSize = 12.5.sp)
            }
        }
    }
}

@Composable
private fun PickerSourceRow(
    source: StreamSource,
    isRecommended: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)
    val hasQuality = source.quality != "unknown"
    val size = SourceRanker.formatSize(source.sizeBytes)

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(
                when {
                    focused -> OpenTvColors.Content.copy(alpha = 0x20 / 255f)
                    isRecommended -> Color(0x0F7EE2A8)
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
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .width(74.dp)
                .height(44.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(if (hasQuality) OpenTvColors.Content else OpenTvColors.Content.copy(alpha = 0x1A / 255f)),
        ) {
            Text(
                text = SourceRanker.qualityLabel(source),
                color = if (hasQuality) OpenTvColors.OnContent else OpenTvColors.TextSecondary,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 15.sp,
            )
        }

        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = SourceRanker.plainLanguageLabel(source),
                    color = OpenTvColors.Content,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (isRecommended) {
                    Text(
                        text = "Recomendada",
                        color = Color(0xFF0E0E11),
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.5.sp,
                        maxLines = 1,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(OpenTvColors.MintGreen)
                            .padding(horizontal = 9.dp, vertical = 2.dp),
                    )
                }
            }
            Text(
                text = SourceRanker.sourceDetailLine(source),
                color = OpenTvColors.TextMuted,
                fontSize = 12.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (size.isNotBlank()) {
            Text(size, color = OpenTvColors.TextSecondary, fontSize = 13.sp, maxLines = 1)
        }
        Text(
            text = SourceRanker.typeLabel(source),
            color = if (source.isDirect) OpenTvColors.Content else OpenTvColors.TextSecondary,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.5.sp,
            maxLines = 1,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(OpenTvColors.Content.copy(alpha = if (source.isDirect) 0x1F / 255f else 0x0D / 255f))
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

/** Lite mode asks for ~60 % of the usual width: sharp enough, far fewer bytes and less RAM. */
internal fun liteWidth(widthPx: Int, lite: Boolean): Int =
    if (lite) (widthPx * 0.6f).toInt().coerceAtLeast(160) else widthPx
