package com.techpoint.opentv.ui.nav

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.focusProperties
import com.techpoint.opentv.ui.theme.V1Icons
import com.techpoint.opentv.ui.components.resolvedAvatarIndex
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.ChildCare
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.R
import com.techpoint.opentv.core.model.HomeTab
import com.techpoint.opentv.core.model.UserProfile
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

fun tabIcon(tab: HomeTab): ImageVector = when (tab) {
    HomeTab.LIVE -> Icons.Rounded.LiveTv
    HomeTab.HOME -> Icons.Rounded.Home
    HomeTab.MOVIES -> Icons.Rounded.Movie
    HomeTab.SERIES -> Icons.Rounded.Tv
    HomeTab.KIDS -> Icons.Rounded.ChildCare
    HomeTab.ANIME -> Icons.Rounded.AutoAwesome
}

/**
 * Exact OpenTV v1 smiley profile avatar (`docs/screenshots/inicio.jpg` & `tv.jpg`).
 */
@Composable
fun OpenTvSmileyAvatar(
    color: Color,
    isKids: Boolean = false,
    size: Dp = 36.dp,
    inverted: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val fg = if (inverted) OpenTvColors.BgCanvas else Color.White
    val bgBrush = remember(color, inverted) {
        if (inverted) {
            Brush.linearGradient(listOf(Color.White, Color.White))
        } else {
            val pair = when (color) {
                Color(0xFF3B82F6) -> Color(0xFF3A7BFF) to Color(0xFF8A4DFF) // Signature v1/PC blue-to-purple
                Color(0xFF8B5CF6) -> Color(0xFF8B5CF6) to Color(0xFFEC4899)
                Color(0xFF22C55E) -> Color(0xFF22C55E) to Color(0xFF0D9488)
                Color(0xFFF59E0B) -> Color(0xFFF59E0B) to Color(0xFFEA580C)
                Color(0xFFE50914) -> Color(0xFFEF4444) to Color(0xFFB91C1C)
                else -> color to Color(
                    red = (color.red * 0.72f).coerceIn(0f, 1f),
                    green = (color.green * 0.72f).coerceIn(0f, 1f),
                    blue = (color.blue * 0.92f).coerceIn(0f, 1f),
                    alpha = color.alpha,
                )
            }
            Brush.linearGradient(listOf(pair.first, pair.second))
        }
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.size(size).clip(CircleShape).background(bgBrush),
    ) {
        if (isKids) {
            Icon(Icons.Rounded.ChildCare, null, tint = fg, modifier = Modifier.size(size * 0.58f))
        } else {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val w = this.size.width
                val h = this.size.height
                val eyeR = w * 0.068f
                drawCircle(color = fg, radius = eyeR, center = Offset(w * 0.36f, h * 0.40f))
                drawCircle(color = fg, radius = eyeR, center = Offset(w * 0.64f, h * 0.40f))
                drawArc(
                    color = fg,
                    startAngle = 20f,
                    sweepAngle = 140f,
                    useCenter = false,
                    topLeft = Offset(w * 0.28f, h * 0.42f),
                    size = Size(w * 0.44f, h * 0.30f),
                    style = Stroke(width = w * 0.078f, cap = StrokeCap.Round),
                )
            }
        }
    }
}

fun tvRailIcon(tab: HomeTab): ImageVector = when (tab) {
    HomeTab.LIVE -> V1Icons.Tv
    HomeTab.HOME -> V1Icons.Home
    HomeTab.MOVIES -> V1Icons.Film
    HomeTab.SERIES -> V1Icons.Series
    HomeTab.KIDS -> V1Icons.Kids
    HomeTab.ANIME -> V1Icons.Anime
}

/**
 * OpenTV v1 Android TV / Fire TV left rail (`10-teles.css` 22-54, `screens/home.js` 95-198).
 * Resting focus on an item for 280 ms switches the section (no click needed).
 */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun TvLeftRail(
    tabs: List<HomeTab>,
    selectedTab: HomeTab,
    onSelectTab: (HomeTab) -> Unit,
    onHoverLabelChange: (String?) -> Unit,
    modifier: Modifier = Modifier,
    selectedFocusRequester: FocusRequester? = null,
    onRailFocusChanged: (Boolean) -> Unit = {},
    // Where → from the rail lands (v1 enters the section's content, never the top bar).
    // Read at key-press time, so it can point at the last focused card of the content.
    rightFocus: (() -> FocusRequester?)? = null,
) {
    val ui = LocalOpenTvUi.current
    var anyFocused by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .width(130.dp)
            .fillMaxHeight()
            .background(
                // Near-opaque behind the icons so posters scrolled under the rail never
                // show through (row centring scrolls cards left past the content edge).
                Brush.horizontalGradient(
                    0f to Color(0xFA0E0E11),
                    0.7f to Color(0xF00E0E11),
                    1f to Color.Transparent,
                ),
            ),
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .padding(start = 28.dp)
                .width(60.dp)
                .fillMaxHeight()
                .onFocusChanged {
                    if (it.hasFocus != anyFocused) {
                        anyFocused = it.hasFocus
                        onRailFocusChanged(it.hasFocus)
                        if (!it.hasFocus) onHoverLabelChange(null)
                    }
                }
                // ← from any row of the content always lands on the active section (Inicio…),
                // never on whichever icon happens to sit at the same height.
                .focusProperties {
                    enter = { selectedFocusRequester ?: FocusRequester.Default }
                }
                .focusGroup(),
        ) {
            tabs.forEachIndexed { tabIdx, tab ->
                val interaction = remember { MutableInteractionSource() }
                val focused by interaction.collectIsFocusedAsState()
                val selected = tab == selectedTab
                val ownFocus = remember { FocusRequester() }
                val isFirst = tabIdx == 0
                val isLast = tabIdx == tabs.lastIndex

                LaunchedEffect(focused) {
                    if (focused) {
                        onHoverLabelChange(tab.label)
                        if (!selected) {
                            delay(280L)
                            onSelectTab(tab)
                        }
                    }
                }

                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.width(60.dp).height(40.dp),
                ) {
                    if (selected) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.CenterStart)
                                .offset(x = (-1).dp)
                                .width(2.dp)
                                .height(16.dp)
                                .clip(RoundedCornerShape(1.dp))
                                .background(ui.accent.color),
                        )
                    }
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(width = 44.dp, height = 40.dp)
                            // Same modifier type in the same slot on every item: swapping only the requester keeps
                            // the focus node alive when the selection changes (no focus loss on tab switch).
                            .focusRequester(if (selected && selectedFocusRequester != null) selectedFocusRequester else ownFocus)
                            // v1: Up/Down never leave the rail and Left is swallowed.
                            .focusProperties {
                                left = FocusRequester.Cancel
                                rightFocus?.invoke()?.let { right = it }
                                if (isFirst) up = FocusRequester.Cancel
                                if (isLast) down = FocusRequester.Cancel
                            }
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (focused) ui.accent.color else Color.Transparent)
                            .clickable(interactionSource = interaction, indication = null) { onSelectTab(tab) },
                    ) {
                        Icon(
                            imageVector = tvRailIcon(tab),
                            contentDescription = tab.label,
                            tint = when {
                                focused -> ui.accent.onAccent
                                selected -> Color.White
                                else -> Color(0x9EFFFFFF)
                            },
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * OpenTV v1 TV top bar (`10-teles.css` 57-63/152-156, `screens/home.js` 230-282):
 * logo + section label on the left; Buscar, Mi lista, avatar, Wi-Fi and clock on the right.
 */
@Composable
fun TvTopBar(
    sectionLabel: String,
    labelHighlighted: Boolean,
    scrolled: Boolean,
    activeProfile: UserProfile,
    onSearch: () -> Unit,
    onMyList: () -> Unit,
    onProfile: () -> Unit,
    modifier: Modifier = Modifier,
    searchFocus: FocusRequester? = null,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(84.dp)
            .then(
                if (scrolled) Modifier.background(Color(0xF50E0E11)).drawBehind {
                    drawLine(Color(0x0FFFFFFF), Offset(0f, size.height - 1f), Offset(size.width, size.height - 1f), 1f)
                } else Modifier.background(
                    Brush.verticalGradient(
                        0f to Color(0xB308080A),
                        0.6f to Color(0x4D08080A),
                        1f to Color.Transparent,
                    ),
                ),
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 29.dp, top = 26.dp).height(22.dp),
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_opentv_logo),
                contentDescription = "OpenTV",
                modifier = Modifier.size(width = 20.dp, height = 21.dp),
            )
            Spacer(Modifier.width(7.dp))
            Text(
                text = "OpenTV",
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                letterSpacing = (-0.4).sp,
            )
            Spacer(Modifier.width(12.dp))
            Box(Modifier.width(1.dp).height(16.dp).background(Color(0x38FFFFFF)))
            Spacer(Modifier.width(10.dp))
            Text(
                text = sectionLabel,
                color = if (labelHighlighted) Color.White else Color(0x99FFFFFF),
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
            )
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(end = 60.dp, top = 20.dp)
                .height(30.dp),
        ) {
            TvTopIcon(V1Icons.Search, "Buscar", onSearch, if (searchFocus != null) Modifier.focusRequester(searchFocus) else Modifier)
            Spacer(Modifier.width(10.dp))
            TvTopIcon(V1Icons.MyList, "Mi lista", onMyList)
            Spacer(Modifier.width(10.dp))
            ProfileAvatarButton(profile = activeProfile, onClick = onProfile, size = 30.dp)
            Spacer(Modifier.width(13.5.dp))
            Box(Modifier.width(0.75.dp).height(14.dp).background(Color(0x33FFFFFF)))
            Spacer(Modifier.width(13.5.dp))
            Icon(
                imageVector = Icons.Rounded.Wifi,
                contentDescription = null,
                tint = Color(0xFFD8D8D8),
                modifier = Modifier.size(15.dp),
            )
            Spacer(Modifier.width(13.5.dp))
            TvClockText(fontSize = 17f)
        }
    }
}

@Composable
private fun TvTopIcon(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(30.dp)
            .clip(CircleShape)
            .background(if (focused) ui.accent.color else Color(0x14FFFFFF))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            tint = if (focused) ui.accent.onAccent else Color.White,
            modifier = Modifier.size(15.dp),
        )
    }
}

/**
 * Exact replica of OpenTV v1 top bar (`inicio.jpg`, `peliculas.jpg`, `tv.jpg`, `celular.jpg`).
 */
@Composable
fun OpenTvTopBar(
    tabs: List<HomeTab>,
    selectedTab: HomeTab,
    tvBrowseLabel: String?,
    scrolled: Boolean,
    activeProfile: UserProfile,
    onSelectTab: (HomeTab) -> Unit,
    onSearch: () -> Unit,
    onMyList: () -> Unit,
    onSettings: () -> Unit,
    onProfile: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val bgColor by animateColorAsState(
        if (scrolled) Color(0xF50E0E11) else Color(0x9908080A),
        label = "topBarBg",
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(
                if (scrolled) Brush.verticalGradient(listOf(bgColor, bgColor))
                else Brush.verticalGradient(listOf(Color(0xCC08080A), Color(0x4D08080A), Color.Transparent)),
            )
            .statusBarsPadding()
            .padding(
                horizontal = if (ui.isTv) 28.dp else 14.dp,
                vertical = if (ui.isTv) 14.dp else 10.dp,
            ),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            // Exact OpenTV v1 vector TV mark + wordmark
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(id = R.drawable.ic_opentv_logo),
                    contentDescription = "OpenTV",
                    modifier = Modifier.size(if (ui.isTv) 28.dp else 25.dp),
                )
                Spacer(Modifier.width(9.dp))
                Text(
                    text = "OpenTV",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = if (ui.isTv) 20.sp else 18.sp,
                    letterSpacing = (-0.4).sp,
                )
                if (ui.isTv) {
                    Spacer(Modifier.width(12.dp))
                    Box(
                        modifier = Modifier
                            .width(1.5.dp)
                            .height(18.dp)
                            .background(Color(0x38FFFFFF)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = tvBrowseLabel ?: selectedTab.label,
                        color = if (tvBrowseLabel != null) Color.White else OpenTvColors.TextSecondary,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                    )
                }
            }

            Spacer(Modifier.weight(1f))

            // Right cluster matching `inicio.jpg` / `tv.jpg`: Buscar, Mi lista, Ajustes, Smiley Avatar, Wi-Fi + Clock
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TopBarActionIcon(Icons.Rounded.Search, "Buscar", onSearch)
                TopBarActionIcon(Icons.Rounded.BookmarkBorder, "Mi lista", onMyList)
                TopBarActionIcon(Icons.Rounded.Settings, "Ajustes", onSettings)
                ProfileAvatarButton(profile = activeProfile, onClick = onProfile)
                if (ui.isTv) {
                    Spacer(Modifier.width(6.dp))
                    Box(Modifier.width(1.dp).height(16.dp).background(Color(0x28FFFFFF)))
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        imageVector = Icons.Rounded.Wifi,
                        contentDescription = null,
                        tint = OpenTvColors.TextSecondary,
                        modifier = Modifier.size(16.dp),
                    )
                    TvClockText()
                }
            }
        }

        // Mobile/Tablet monochrome tabs matching `inicio.jpg` / `celular.jpg`
        if (!ui.isTv && tabs.size > 1) {
            Spacer(Modifier.height(10.dp))
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                items(tabs, key = { it.id }) { tab ->
                    val selected = tab == selectedTab
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(if (selected) ui.accent.color else Color(0x14FFFFFF))
                            .clickable { onSelectTab(tab) }
                            .padding(horizontal = 15.dp, vertical = 7.dp),
                    ) {
                        Text(
                            text = tab.label,
                            color = if (selected) ui.accent.onAccent else Color(0xCCFFFFFF),
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            fontSize = 13.5.sp,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TopBarActionIcon(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(if (focused) ui.accent.color else Color(0x14FFFFFF))
            .border(
                width = 1.dp,
                color = if (focused) ui.accent.color else OpenTvColors.GlassBorder,
                shape = CircleShape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            tint = if (focused) ui.accent.onAccent else Color.White,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun ProfileAvatarButton(
    profile: UserProfile,
    onClick: () -> Unit,
    size: Dp = 36.dp,
) {
    val ui = LocalOpenTvUi.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()

    Box(
        modifier = Modifier
            .clip(CircleShape)
            .border(
                width = if (focused) 2.5.dp else 0.dp,
                color = if (focused) ui.accent.color else Color.Transparent,
                shape = CircleShape,
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        // Same avatar as PC's top bar (`ProfileAvatar round`); focus shows the accent ring.
        com.techpoint.opentv.ui.components.ProfileAvatar(
            index = profile.resolvedAvatarIndex(),
            size = size,
            round = true,
        )
    }
}

@Composable
private fun TvClockText(fontSize: Float = 14.5f) {
    var time by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        val fmt = SimpleDateFormat("h:mm a", Locale.US)
        while (true) {
            time = fmt.format(Date())
            delay(15_000L)
        }
    }
    Text(
        text = time,
        color = Color.White,
        fontWeight = FontWeight.SemiBold,
        fontSize = fontSize.sp,
    )
}
