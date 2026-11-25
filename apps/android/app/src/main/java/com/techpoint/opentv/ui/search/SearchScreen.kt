package com.techpoint.opentv.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ViewList
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.core.addons.StremioClient
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.ui.components.OpenTvChip
import com.techpoint.opentv.ui.components.OpenTvImage
import com.techpoint.opentv.ui.components.OpenTvPrimaryButton
import com.techpoint.opentv.ui.components.OpenTvRoundIconButton
import com.techpoint.opentv.ui.components.PosterCard
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors

/**
 * Exact 1:1 visual replica of OpenTV v1 Search (`docs/screenshots/buscador.jpg`):
 * - Round back button + rounded search input + solid white `🔍 Buscar` pill button
 * - Result count + `Cuadrícula | Lista` segmented toggle
 * - Posters with Title + `Año · Película/Serie` cleanly beneath each card (or OpenTV TV mark when art missing).
 */
@Composable
fun SearchScreen(
    stremio: StremioClient,
    plugins: List<InstalledPlugin>,
    recentSearches: List<String>,
    kidsOnly: Boolean,
    onAddRecent: (String) -> Unit,
    onClearRecent: () -> Unit,
    onOpenDetail: (MediaItem) -> Unit,
    onBack: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val keyboard = LocalSoftwareKeyboardController.current
    var query by rememberSaveable { mutableStateOf("") }
    // What was last searched: the search runs only on "Buscar" (or a recent search), never
    // while typing.
    var submitted by rememberSaveable { mutableStateOf("") }
    var searchNonce by remember { mutableIntStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("all") }
    var listMode by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }

    fun submit(text: String) {
        val clean = text.trim()
        if (clean.length < 2) return
        query = clean
        submitted = clean
        searchNonce++
        keyboard?.hide()
        onAddRecent(clean)
    }

    fun changeQuery(text: String) {
        query = text
        if (text.isBlank()) submitted = ""
    }

    LaunchedEffect(submitted, searchNonce, kidsOnly) {
        val clean = submitted
        if (clean.length < 2) {
            results = emptyList()
            loading = false
            return@LaunchedEffect
        }
        results = emptyList()
        loading = true
        results = stremio.search(clean, plugins, kidsOnly = kidsOnly)
        loading = false
    }

    val filtered = remember(results, filter) {
        when (filter) {
            "movie" -> results.filter { it.type == "movie" }
            "series" -> results.filter { it.type == "series" }
            "anime" -> results.filter { it.isAnime }
            else -> results
        }
    }

    if (ui.isTv) {
        SearchTvLayout(
            query = query,
            submittedQuery = submitted,
            onQueryChange = ::changeQuery,
            onSubmit = ::submit,
            results = filtered,
            loading = loading,
            filter = filter,
            onFilterChange = { filter = it },
            kidsOnly = kidsOnly,
            recentSearches = recentSearches,
            onClearRecent = onClearRecent,
            onOpenDetail = onOpenDetail,
        )
        return
    }

    val hPad = if (ui.isTv) 44.dp else 16.dp

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(OpenTvColors.BgCanvas)
            .statusBarsPadding()
            .padding(horizontal = hPad, vertical = 14.dp),
    ) {
        // Exact `buscador.jpg` top search bar + white "Buscar" button
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            OpenTvRoundIconButton(Icons.AutoMirrored.Rounded.ArrowBack, "Volver", onBack, size = 40.dp)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .weight(1f)
                    .height(46.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(OpenTvColors.GlassFill)
                    .border(1.dp, OpenTvColors.GlassBorderStrong, RoundedCornerShape(14.dp))
                    .padding(horizontal = 14.dp),
            ) {
                Icon(Icons.Rounded.Search, null, tint = OpenTvColors.TextMuted, modifier = Modifier.size(19.dp))
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) {
                        Text("Buscar películas, series o anime…", color = OpenTvColors.TextMuted, fontSize = 15.sp)
                    }
                    BasicTextField(
                        value = query,
                        onValueChange = ::changeQuery,
                        singleLine = true,
                        textStyle = TextStyle(color = OpenTvColors.Content, fontSize = 15.sp),
                        cursorBrush = SolidColor(ui.accent.color),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { submit(query) }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (query.isNotEmpty()) {
                    Icon(
                        imageVector = Icons.Rounded.Close,
                        contentDescription = "Borrar",
                        tint = OpenTvColors.TextSecondary,
                        modifier = Modifier.size(19.dp).clickable { changeQuery("") },
                    )
                }
            }
            OpenTvPrimaryButton(
                text = "Buscar",
                icon = Icons.Rounded.Search,
                onClick = { submit(query) },
            )
        }

        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = OpenTvColors.SubtleDivider)
        Spacer(Modifier.height(12.dp))

        if (submitted.length < 2) {
            if (recentSearches.isNotEmpty()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Búsquedas recientes", style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = "Limpiar",
                        color = OpenTvColors.TextMuted,
                        fontSize = 13.sp,
                        modifier = Modifier.clickable(onClick = onClearRecent),
                    )
                }
                Spacer(Modifier.height(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(recentSearches) { rec ->
                        OpenTvChip(label = rec, selected = false, onClick = { submit(rec) })
                    }
                }
            } else {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = "Escribe un título en español o en su idioma original y pulsa Buscar",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
        } else {
            // Results bar: count + filters + Cuadrícula / Lista toggle (`buscador.jpg`)
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = if (loading && filtered.isEmpty()) "Buscando…" else "${filtered.size} resultados",
                    style = MaterialTheme.typography.titleMedium,
                    color = OpenTvColors.TextSecondary,
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(OpenTvColors.GlassFill)
                        .border(1.dp, OpenTvColors.GlassBorder, RoundedCornerShape(999.dp))
                        .padding(3.dp),
                ) {
                    ViewModePill("Cuadrícula", Icons.Rounded.GridView, !listMode) { listMode = false }
                    ViewModePill("Lista", Icons.AutoMirrored.Rounded.ViewList, listMode) { listMode = true }
                }
            }

            Spacer(Modifier.height(10.dp))

            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val opts = buildList {
                    add("all" to "Todo")
                    add("movie" to "Películas")
                    add("series" to "Series")
                    if (!kidsOnly) add("anime" to "Anime")
                }
                items(opts) { (id, label) ->
                    OpenTvChip(label = label, selected = filter == id, onClick = { filter = id })
                }
            }

            Spacer(Modifier.height(14.dp))

            if (loading && filtered.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
                }
            } else if (filtered.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Sin resultados para \"$submitted\"", style = MaterialTheme.typography.bodyLarge)
                }
            } else if (!listMode) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = if (ui.isTv) 136.dp else 108.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    contentPadding = PaddingValues(bottom = 32.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(filtered, key = { it.id }) { item ->
                        PosterCard(
                            item = item,
                            showCaptionBelow = true,
                            showMetaBelow = true,
                            onClick = {
                                onOpenDetail(item)
                            },
                        )
                    }
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 32.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(filtered, key = { it.id }) { item ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(OpenTvColors.GlassFill)
                                .border(1.dp, OpenTvColors.GlassBorder, RoundedCornerShape(14.dp))
                                .clickable {
                                    onOpenDetail(item)
                                }
                                .padding(10.dp),
                        ) {
                            OpenTvImage(
                                url = item.poster.ifBlank { item.backdrop },
                                contentDescription = item.title,
                                targetWidthPx = 140,
                                modifier = Modifier.size(width = 52.dp, height = 74.dp).clip(RoundedCornerShape(8.dp)),
                            )
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(item.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                val kind = if (item.isAnime) "Anime" else if (item.isSeries) "Serie" else "Película"
                                Text(
                                    listOf(item.year.takeIf { it.isNotBlank() && it != "—" }, kind, item.score.takeIf { it.isNotBlank() && it != "—" }?.let { "★ $it" })
                                        .filterNotNull()
                                        .joinToString(" · "),
                                    style = MaterialTheme.typography.labelMedium,
                                )
                                if (item.synopsis.isNotBlank()) {
                                    Text(item.synopsis, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ViewModePill(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (selected) ui.accent.color else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 5.dp),
    ) {
        Icon(icon, null, tint = if (selected) ui.accent.onAccent else OpenTvColors.TextMuted, modifier = Modifier.size(14.dp))
        Text(
            text = label,
            color = if (selected) ui.accent.onAccent else OpenTvColors.TextSecondary,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
        )
    }
}
