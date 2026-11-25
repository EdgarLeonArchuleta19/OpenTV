package com.techpoint.opentv.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.History
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.focus.focusRequester
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors


/**
 * v1 TV search (`10-teles.css` #screen-search): keyboard panel on the left
 * (0–350dp, #0b0b0e) and a 4-column poster grid on the right.
 */
@Composable
internal fun SearchTvLayout(
    query: String,
    /** Last searched text (results show only after "Buscar"). */
    submittedQuery: String,
    onQueryChange: (String) -> Unit,
    onSubmit: (String) -> Unit,
    results: List<MediaItem>,
    loading: Boolean,
    filter: String,
    onFilterChange: (String) -> Unit,
    kidsOnly: Boolean,
    recentSearches: List<String>,
    onClearRecent: () -> Unit,
    onOpenDetail: (MediaItem) -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val firstKey = remember { FocusRequester() }
    // Result opened last: Back from its ficha lands on it again (Buscar keeps its state).
    var lastOpenedId by rememberSaveable { mutableStateOf<String?>(null) }
    val lastOpenedFocus = remember { FocusRequester() }
    val restoreToResult by rememberUpdatedState(lastOpenedId != null && results.any { it.id == lastOpenedId })

    LaunchedEffect(Unit) {
        // Back from a ficha: wait for the results to come back and focus the opened title.
        val restored = lastOpenedId != null &&
            withTimeoutOrNull(6_000L) { snapshotFlow { restoreToResult }.first { it } } != null
        // Wait one frame so the node is attached before asking for focus.
        withFrameNanos { }
        if (!restored || runCatching { lastOpenedFocus.requestFocus() }.isFailure) {
            runCatching { firstKey.requestFocus() }
        }
        lastOpenedId = null
    }

    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenTvColors.BgCanvas),
    ) {
        // Keyboard panel
        Box(
            modifier = Modifier
                .width(420.dp)
                .fillMaxHeight()
                .background(if (OpenTvColors.isLight) OpenTvColors.Ink800 else Color(0xFF0B0B0E)),
        ) {
            Column(modifier = Modifier.padding(start = 50.dp, top = 34.dp)) {
                Text(
                    text = "Buscar",
                    color = OpenTvColors.Content,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.ExtraBold,
                    maxLines = 1,
                )
                Spacer(Modifier.height(14.dp))
                TvKeyboard(
                    value = query,
                    onValueChange = onQueryChange,
                    placeholder = "Películas, series o anime…",
                    doneLabel = "Buscar",
                    onDone = { onSubmit(query) },
                    firstKeyFocusRequester = firstKey,
                    // Big keys readable from the sofa: 7 columns of ~41dp in a 322dp panel.
                    keyHeight = 42.dp,
                    keyFontSize = 18.sp,
                    displayHeight = 46.dp,
                    displayFontSize = 16.sp,
                    gap = 6.dp,
                    modifier = Modifier.width(322.dp),
                )
            }
            // 1px divider on the right edge (`border-right: rgba(255,255,255,.06)`)
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .width(1.dp)
                    .fillMaxHeight()
                    .background(OpenTvColors.fg(0.06f)),
            )
        }

        // Results
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(start = 28.dp, end = 48.dp, top = 40.dp),
        ) {
            if (submittedQuery.length < 2) {
                if (recentSearches.isNotEmpty()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Búsquedas recientes", color = OpenTvColors.Content, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        TvPill(label = "Borrar todo", selected = false, onClick = onClearRecent)
                    }
                    Spacer(Modifier.height(12.dp))
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        contentPadding = PaddingValues(bottom = 32.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(recentSearches.distinct(), key = { it }) { rec ->
                            RecentRow(text = rec, onClick = { onSubmit(rec) })
                        }
                    }
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            text = "Escribe un título en español o en su idioma original y pulsa Buscar",
                            color = OpenTvColors.TextMuted,
                            fontSize = 14.sp,
                        )
                    }
                }
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = if (loading && results.isEmpty()) "Buscando…" else "${results.size} resultados",
                        color = OpenTvColors.TextSecondary,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    val opts = remember(kidsOnly) {
                        buildList {
                            add("all" to "Todo")
                            add("movie" to "Películas")
                            add("series" to "Series")
                            if (!kidsOnly) add("anime" to "Anime")
                        }
                    }
                    com.techpoint.opentv.ui.components.TvCenteredRowScope {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(opts, key = { it.first }) { (id, label) ->
                            TvPill(label = label, selected = filter == id, onClick = { onFilterChange(id) })
                        }
                    }
                    }
                }

                Spacer(Modifier.height(8.dp))

                when {
                    loading && results.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
                    }
                    results.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Sin resultados para \"$submittedQuery\"", color = OpenTvColors.TextMuted, fontSize = 14.sp)
                    }
                    else -> LazyVerticalGrid(
                        columns = GridCells.Fixed(4),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        // Room so the 1.06 focus scale is not clipped at the edges.
                        contentPadding = PaddingValues(start = 6.dp, end = 6.dp, top = 8.dp, bottom = 40.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(results, key = { it.id }) { item ->
                            SearchTvPoster(
                                item = item,
                                onClick = {
                                    lastOpenedId = item.id
                                    onOpenDetail(item)
                                },
                                modifier = if (item.id == lastOpenedId) Modifier.focusRequester(lastOpenedFocus) else Modifier,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Poster with v1 TV focus: scale 1.06 and a 2dp white ring. */
@Composable
private fun SearchTvPoster(item: MediaItem, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .zIndex(if (focused) 1f else 0f)
            .graphicsLayer {
                val s = if (focused) 1.06f else 1f
                scaleX = s
                scaleY = s
            }
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(shape)
                .background(OpenTvColors.CardSurface)
                .border(if (focused) 2.dp else 1.dp, if (focused) OpenTvColors.Content else OpenTvColors.GlassBorder, shape),
        ) {
            val img = item.poster.ifBlank { item.backdrop }
            if (img.isNotBlank()) {
                OpenTvImage(
                    url = img,
                    contentDescription = item.title,
                    targetWidthPx = 260,
                    modifier = Modifier.fillMaxSize().padding(if (focused) 2.dp else 0.dp),
                )
            } else {
                Text(
                    text = item.title,
                    color = OpenTvColors.TextSecondary,
                    fontSize = 12.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(10.dp),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = item.title,
            color = if (focused) OpenTvColors.Content else OpenTvColors.TextSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        val kind = when {
            item.isAnime -> "Anime"
            item.isSeries -> "Serie"
            else -> "Película"
        }
        Text(
            text = listOfNotNull(item.year.takeIf { it.isNotBlank() && it != "—" }, kind).joinToString(" · "),
            color = OpenTvColors.TextMuted,
            fontSize = 11.sp,
            maxLines = 1,
        )
    }
}

/** Small TV pill: white when focused, accent when selected. */
@Composable
private fun TvPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val bg = when {
        focused -> OpenTvColors.Content
        selected -> ui.accent.color
        else -> OpenTvColors.fg(0.08f)
    }
    val fg = when {
        focused -> OpenTvColors.OnContent
        selected -> ui.accent.onAccent
        else -> OpenTvColors.Content
    }
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .height(28.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp),
    ) {
        Text(label, color = fg, fontSize = 12.sp, fontWeight = if (selected || focused) FontWeight.Bold else FontWeight.Medium, maxLines = 1)
    }
}

@Composable
private fun RecentRow(text: String, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val fg = if (focused) OpenTvColors.OnContent else OpenTvColors.Content
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(38.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (focused) OpenTvColors.Content else OpenTvColors.fg(0.04f))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 12.dp),
    ) {
        Icon(Icons.Rounded.History, null, tint = if (focused) OpenTvColors.OnContent else OpenTvColors.TextMuted, modifier = Modifier.size(16.dp))
        Text(text, color = fg, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
