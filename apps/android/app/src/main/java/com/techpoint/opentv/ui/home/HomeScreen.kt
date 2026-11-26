package com.techpoint.opentv.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.collectAsState
import com.techpoint.opentv.core.data.CatalogRepository
import com.techpoint.opentv.core.model.CatalogRow
import com.techpoint.opentv.core.model.HomeTab
import com.techpoint.opentv.core.model.InstalledPlugin
import com.techpoint.opentv.core.model.MediaItem
import com.techpoint.opentv.core.model.WatchProgress
import com.techpoint.opentv.core.model.continueWatchingRow
import com.techpoint.opentv.ui.components.ContinueWatchingCard
import com.techpoint.opentv.ui.components.HeroBanner
import com.techpoint.opentv.ui.components.PosterCard
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import kotlinx.coroutines.delay

@Composable
fun HomeCatalogContent(
    tab: HomeTab,
    catalogs: CatalogRepository,
    plugins: List<InstalledPlugin>,
    continueWatching: List<WatchProgress>,
    isInMyList: (String) -> Boolean,
    onScrolledChanged: (Boolean) -> Unit,
    onPlayItem: (MediaItem) -> Unit,
    onResumeEntry: (WatchProgress) -> Unit,
    onOpenDetail: (MediaItem) -> Unit,
    onToggleMyList: (MediaItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val sectionFlow = remember(tab) { catalogs.section(tab.id) }
    val section by sectionFlow.collectAsState()
    val rows: List<CatalogRow> = section.rows
    val loading = section.pending
    var heroIndex by remember(tab) { mutableIntStateOf(0) }

    val listState = rememberLazyListState()
    val isScrolled by remember {
        derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 140 }
    }
    LaunchedEffect(isScrolled) { onScrolledChanged(isScrolled) }

    LaunchedEffect(tab, plugins) { catalogs.ensureLoaded(tab.id, plugins) }

    val heroItems = remember(rows) {
        rows.firstOrNull()?.items?.filter { it.backdrop.isNotBlank() || it.poster.isNotBlank() }?.take(6).orEmpty()
    }

    // Gentle auto-rotation of Hero carousel (only while at the top of the page)
    LaunchedEffect(heroItems, isScrolled) {
        if (heroItems.size <= 1 || isScrolled) return@LaunchedEffect
        while (true) {
            delay(8500L)
            heroIndex = (heroIndex + 1) % heroItems.size
        }
    }

    val filteredContinue = remember(continueWatching, tab) {
        continueWatching.continueWatchingRow().filter { entry ->
            when (tab) {
                HomeTab.MOVIES -> entry.type == "movie"
                HomeTab.SERIES -> entry.type == "series"
                HomeTab.ANIME -> entry.type == "anime"
                HomeTab.HOME -> true
                else -> false
            }
        }
    }

    if (loading && rows.isEmpty()) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = ui.accent.color, strokeWidth = 3.dp)
        }
        return
    }

    val hPad = if (ui.isTv) 28.dp else 16.dp
    val posterWidth = if (ui.isTv) 136.dp else 128.dp

    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
        modifier = modifier.fillMaxSize(),
    ) {
        if (heroItems.isNotEmpty()) {
            item(key = "hero_${tab.id}", contentType = "hero") {
                HeroBanner(
                    items = heroItems,
                    selectedIndex = heroIndex.coerceIn(0, heroItems.lastIndex),
                    onSelectIndex = { heroIndex = it },
                    isInMyList = isInMyList,
                    onPlay = onPlayItem,
                    onDetails = onOpenDetail,
                    onToggleList = onToggleMyList,
                )
            }
        } else {
            item(key = "top_spacer") {
                Spacer(Modifier.height(if (ui.isTv) 68.dp else 104.dp))
            }
        }

        if (filteredContinue.isNotEmpty()) {
            item(key = "continue_${tab.id}", contentType = "continue_row") {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "Seguir viendo",
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.padding(horizontal = hPad),
                    )
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = hPad),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        items(filteredContinue, key = { "${it.itemId}_${it.season}_${it.episode}" }) { entry ->
                            ContinueWatchingCard(
                                entry = entry,
                                onClick = { onResumeEntry(entry) },
                                width = if (ui.isTv) 256.dp else 226.dp,
                            )
                        }
                    }
                }
            }
        }

        items(rows, key = { it.id }, contentType = { "poster_row" }) { row ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = row.title,
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(horizontal = hPad),
                )
                LazyRow(
                    contentPadding = PaddingValues(horizontal = hPad),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(row.items, key = { "${row.id}_${it.id}" }) { item ->
                        PosterCard(
                            item = item,
                            onClick = { onOpenDetail(item) },
                            width = posterWidth,
                        )
                    }
                }
            }
        }

        if (rows.isEmpty() && !loading) {
            item(key = "empty") {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                ) {
                    Text(
                        text = "No se pudo cargar el catálogo. Revisa tu conexión a internet.",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
        }
    }
}
