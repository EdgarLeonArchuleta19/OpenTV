package com.techpoint.opentv.ui.profiles

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.techpoint.opentv.core.model.UserProfile
import com.techpoint.opentv.ui.components.stableFocusRequester
import com.techpoint.opentv.ui.components.PROFILE_AVATARS
import com.techpoint.opentv.ui.components.ProfileAvatar
import com.techpoint.opentv.ui.components.resolvedAvatarIndex
import com.techpoint.opentv.ui.search.TvKeyboard
import androidx.compose.foundation.layout.aspectRatio
import com.techpoint.opentv.ui.theme.LocalOpenTvUi
import com.techpoint.opentv.ui.theme.OpenTvColors

/*
 * OpenTV v1 "¿Quién está viendo?" (screens/profiles-ui.js + 07-inicio-hero-perfiles.css 315-348,
 * 10-teles.css 529-536). The v1 picker is not inside the scaled 1920 canvas, so CSS px ≈ dp.
 * Lightweight on purpose (Fire TV 1 GB): no blur, no animations, focus = instant scale + ring.
 */

private const val PROFILES_MAX = 6
private const val ADD_KEY = "__add__"
private const val NEW_KEY = "__new__"



private val PickerNameIdle = Color(0xA6FFFFFF)        // rgba(255,255,255,.65)
private val ManageBorderIdle = Color(0x59FFFFFF)      // rgba(255,255,255,.35)
private val ManageTextIdle = Color(0xBFFFFFFF)        // rgba(255,255,255,.75)
private val DashedBorder = Color(0x4DFFFFFF)          // rgba(255,255,255,.3)
private val PanelScrim = Color(0xEB060608)            // TV editor: rgba(6,6,8,.92), no blur
private val PanelCard = Color(0xFA16161B)             // rgba(22,22,27,.98)
private val PanelBorder = Color(0x1FFFFFFF)           // rgba(255,255,255,.12)
private val DangerText = Color(0xFFFF8A8A)
private val DangerBorder = Color(0x59FF8A8A)

private sealed interface ProfilePanel {
    data object Add : ProfilePanel
    data class Edit(val profileId: String) : ProfilePanel
}

/** Ring drawn outside the bounds (CSS `box-shadow: 0 0 0 Npx`), so the layout never moves. */
private fun Modifier.outerRing(
    show: Boolean,
    corner: Dp,
    width: Dp,
    gap: Dp = 0.dp,
    color: Color = Color.White,
): Modifier = drawBehind {
    if (!show) return@drawBehind
    val w = width.toPx()
    val inset = gap.toPx() + w / 2f
    drawRoundRect(
        color = color,
        topLeft = Offset(-inset, -inset),
        size = Size(size.width + inset * 2f, size.height + inset * 2f),
        cornerRadius = CornerRadius(corner.toPx() + inset),
        style = Stroke(width = w),
    )
}

@Composable
fun ProfilePickerScreen(
    profiles: List<UserProfile>,
    activeId: String,
    onPick: (UserProfile) -> Unit,
    onAddProfile: (name: String, kids: Boolean, avatarIndex: Int) -> Unit,
    onBack: () -> Unit,
    onUpdateProfile: ((id: String, name: String, kids: Boolean, avatarIndex: Int) -> Unit)? = null,
    onDeleteProfile: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val ui = LocalOpenTvUi.current
    val scale = ui.textScale
    var managing by remember { mutableStateOf(false) }
    var panel by remember { mutableStateOf<ProfilePanel?>(null) }

    // Focus restore: one requester, attached (stably) to whichever tile [focusKey] resolves to.
    val restoreFocus = remember { FocusRequester() }
    var focusKey by remember { mutableStateOf(activeId) }
    var focusTick by remember { mutableIntStateOf(0) }
    var countBeforeAdd by remember { mutableIntStateOf(0) }
    val resolvedKey = when (focusKey) {
        NEW_KEY -> profiles.getOrNull(countBeforeAdd)?.id
            ?: if (profiles.size < PROFILES_MAX) ADD_KEY else activeId
        else -> focusKey
    }
    LaunchedEffect(focusTick, resolvedKey) {
        withFrameNanos { }
        runCatching { restoreFocus.requestFocus() }
    }

    fun closePanel(returnTo: String) {
        panel = null
        focusKey = returnTo
        focusTick++
    }

    // Back: the edit/add panel closes first, then manage mode, then the screen.
    BackHandler {
        val open = panel
        when {
            open is ProfilePanel.Edit -> closePanel(open.profileId)
            open is ProfilePanel.Add -> closePanel(if (profiles.size < PROFILES_MAX) ADD_KEY else activeId)
            managing -> managing = false
            else -> onBack()
        }
    }

    val enabled = panel == null
    val tileWidth = if (ui.isTv) 110.dp else 92.dp
    val gap = 23.dp

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .fillMaxSize()
            .background(OpenTvColors.BgCanvas)
            .drawBehind {
                // radial-gradient(70% 70% at 50% 40%, #1a1a20 0%, #0e0e11 70%)
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(Color(0xFF1A1A20), OpenTvColors.BgCanvas),
                        center = Offset(size.width * 0.5f, size.height * 0.4f),
                        radius = size.maxDimension * 0.5f,
                    ),
                )
            }
            .padding(20.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(40.dp),
        ) {
            Text(
                text = if (managing) "Administrar perfiles" else "¿Quién está viendo?",
                color = Color.White,
                fontSize = (38f * scale).sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.01).em,
                textAlign = TextAlign.Center,
            )

            val slots: List<UserProfile?> =
                if (profiles.size < PROFILES_MAX) profiles + listOf<UserProfile?>(null) else profiles
            BoxWithConstraints(
                contentAlignment = Alignment.TopCenter,
                modifier = Modifier.fillMaxWidth(),
            ) {
                val perRow = (((maxWidth + gap) / (tileWidth + gap)).toInt()).coerceAtLeast(1)
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(gap),
                ) {
                    slots.chunked(perRow).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                            row.forEach { p ->
                                if (p != null) {
                                    ProfileTile(
                                        profile = p,
                                        avatarIndex = p.resolvedAvatarIndex(profiles.indexOf(p)),
                                        width = tileWidth,
                                        managing = managing,
                                        enabled = enabled,
                                        scale = scale,
                                        modifier = Modifier.stableFocusRequester(resolvedKey == p.id, restoreFocus),
                                        onClick = {
                                            if (managing) panel = ProfilePanel.Edit(p.id) else onPick(p)
                                        },
                                    )
                                } else {
                                    AddProfileTile(
                                        width = tileWidth,
                                        enabled = enabled,
                                        scale = scale,
                                        modifier = Modifier.stableFocusRequester(resolvedKey == ADD_KEY, restoreFocus),
                                        onClick = { panel = ProfilePanel.Add },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            ManageButton(
                on = managing,
                enabled = enabled,
                scale = scale,
                onClick = { managing = !managing },
            )

            if (!ui.isTv) {
                val backInteraction = remember { MutableInteractionSource() }
                Text(
                    text = "Volver",
                    color = OpenTvColors.TextMuted,
                    fontSize = (14f * scale).sp,
                    modifier = Modifier
                        .clickable(
                            interactionSource = backInteraction,
                            indication = null,
                            enabled = enabled,
                            onClick = onBack,
                        )
                        .padding(8.dp),
                )
            }
        }

        when (val open = panel) {
            null -> Unit
            is ProfilePanel.Add -> PanelScrimBox {
                ProfileEditorPanel(
                    profile = null,
                    initialAvatar = profiles.size % PROFILE_AVATARS.size,
                    profiles = profiles,
                    activeId = activeId,
                    scale = scale,
                    isTv = ui.isTv,
                    onSave = { name, kids, avatar ->
                        countBeforeAdd = profiles.size
                        onAddProfile(name, kids, avatar)
                        closePanel(NEW_KEY)
                    },
                    onDelete = null,
                    onCancel = { closePanel(if (profiles.size < PROFILES_MAX) ADD_KEY else activeId) },
                )
            }
            is ProfilePanel.Edit -> {
                val target = profiles.firstOrNull { it.id == open.profileId }
                if (target == null) {
                    // Gone (deleted elsewhere): close and return to the active profile.
                    LaunchedEffect(open.profileId) { closePanel(activeId) }
                } else {
                    PanelScrimBox {
                        ProfileEditorPanel(
                            profile = target,
                            initialAvatar = target.resolvedAvatarIndex(profiles.indexOf(target)),
                            profiles = profiles,
                            activeId = activeId,
                            scale = scale,
                            isTv = ui.isTv,
                            onSave = { name, kids, avatar ->
                                onUpdateProfile?.invoke(target.id, name, kids, avatar)
                                closePanel(target.id)
                            },
                            onDelete = onDeleteProfile?.let { del ->
                                {
                                    del(target.id)
                                    closePanel(activeId)
                                }
                            },
                            onCancel = { closePanel(target.id) },
                        )
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ tiles

@Composable
private fun ProfileTile(
    profile: UserProfile,
    avatarIndex: Int,
    width: Dp,
    managing: Boolean,
    enabled: Boolean,
    scale: Float,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val corner = width * 0.16f
    val shape = RoundedCornerShape(corner)

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = modifier
            .width(width)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onClick),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width)
                .graphicsLayer {
                    val s = if (focused) 1.05f else 1f
                    scaleX = s
                    scaleY = s
                }
                .outerRing(focused, corner, 4.dp)
                .clip(shape),
        ) {
            // Same 24 gradient avatars as PC (`ProfileAvatar`, rounded 16 %).
            ProfileAvatar(index = avatarIndex, size = width, modifier = Modifier.fillMaxSize())
            if (profile.kids) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0x99000000))
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text(
                        "KIDS",
                        color = Color.White,
                        fontSize = (11f * scale).sp,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = 0.04.em,
                    )
                }
            }
            if (managing) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0x80000000)),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Edit,
                        contentDescription = "Editar",
                        tint = Color.White,
                        modifier = Modifier.size(width * 0.34f),
                    )
                }
            }
        }
        Text(
            text = profile.name,
            color = if (focused) Color.White else PickerNameIdle,
            fontSize = (15f * scale).sp,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun AddProfileTile(
    width: Dp,
    enabled: Boolean,
    scale: Float,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val corner = width * 0.16f

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = modifier
            .width(width)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onClick),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width)
                .graphicsLayer {
                    val s = if (focused) 1.05f else 1f
                    scaleX = s
                    scaleY = s
                }
                .outerRing(focused, corner, 4.dp)
                .clip(RoundedCornerShape(corner))
                .background(Color(0x08FFFFFF))
                .drawBehind {
                    // border: 2px dashed rgba(255,255,255,.3)
                    val stroke = 2.dp.toPx()
                    val half = stroke / 2f
                    drawRoundRect(
                        color = DashedBorder,
                        topLeft = Offset(half, half),
                        size = Size(size.width - stroke, size.height - stroke),
                        cornerRadius = CornerRadius(corner.toPx() - half),
                        style = Stroke(
                            width = stroke,
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 5.dp.toPx()), 0f),
                        ),
                    )
                },
        ) {
            Icon(
                imageVector = Icons.Rounded.Add,
                contentDescription = null,
                tint = Color(0x99FFFFFF),
                modifier = Modifier.size(width * 0.4f),
            )
        }
        Text(
            text = "Agregar",
            color = if (focused) Color.White else PickerNameIdle,
            fontSize = (15f * scale).sp,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** v1 `.pp-manage`: outlined, 16 px uppercase, letter-spacing .08em; `.is-on` = white fill. */
@Composable
private fun ManageButton(
    on: Boolean,
    enabled: Boolean,
    scale: Float,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    val border = when {
        on || focused -> Color.White
        else -> ManageBorderIdle
    }
    val fg = when {
        on -> OpenTvColors.BgCanvas
        focused -> Color.White
        else -> ManageTextIdle
    }
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .outerRing(focused && on, 10.dp, 2.dp, gap = 2.dp)
            .clip(shape)
            .background(if (on) Color.White else Color.Transparent)
            .border(if (focused) 2.dp else 1.dp, border, shape)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled, onClick = onClick)
            .padding(horizontal = 28.dp, vertical = 12.dp),
    ) {
        Text(
            text = (if (on) "Listo" else "Administrar perfiles").uppercase(),
            color = fg,
            fontSize = (16f * scale).sp,
            letterSpacing = 0.08.em,
            fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
        )
    }
}

// ------------------------------------------------------------------ panels

@Composable
private fun PanelScrimBox(content: @Composable () -> Unit) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .background(PanelScrim)
            .padding(20.dp),
    ) {
        content()
    }
}

@Composable
private fun PanelCardColumn(maxWidth: Dp = 560.dp, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    Column(
        modifier = Modifier
            .widthIn(max = maxWidth)
            .fillMaxWidth()
            .clip(shape)
            .background(PanelCard)
            .border(1.dp, PanelBorder, shape)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 26.dp),
    ) {
        content()
    }
}

private fun cleanName(raw: String): String = raw.replace(Regex("\\s+"), " ").trim()

private fun nameError(name: String, profiles: List<UserProfile>, selfId: String?): String? = when {
    name.isEmpty() -> "Escribe un nombre."
    profiles.any { it.id != selfId && it.name.equals(name, ignoreCase = true) } -> "Ya hay un perfil con ese nombre."
    else -> null
}

/**
 * PC "Nuevo perfil" / "Editar perfil" modal (ProfilesScreen.tsx): name, the 8-column picker of
 * the 24 avatars, the Kids switch and Guardar / Cancelar / Eliminar. On TV the name is typed
 * with the on-screen TV keyboard (no system IME); every control is reachable with the D-pad.
 */
@Composable
private fun ProfileEditorPanel(
    profile: UserProfile?,
    initialAvatar: Int,
    profiles: List<UserProfile>,
    activeId: String,
    scale: Float,
    isTv: Boolean,
    onSave: (name: String, kids: Boolean, avatarIndex: Int) -> Unit,
    onDelete: (() -> Unit)?,
    onCancel: () -> Unit,
) {
    val key = profile?.id ?: NEW_KEY
    var name by remember(key) { mutableStateOf(profile?.name.orEmpty()) }
    var kids by remember(key) { mutableStateOf(profile?.kids ?: false) }
    var avatar by remember(key) { mutableIntStateOf(initialAvatar) }
    var msg by remember(key) { mutableStateOf("") }
    var armed by remember(key) { mutableStateOf(false) }
    val firstFocus = remember { FocusRequester() }
    val canKids = profile == null || profile.id != "main"
    val canDelete = onDelete != null && profile != null && profile.id != activeId &&
        profiles.size > 1 && profile.id != "main"

    LaunchedEffect(key) {
        withFrameNanos { }
        runCatching { firstFocus.requestFocus() }
    }

    fun submit() {
        val n = cleanName(name)
        val err = nameError(n, profiles, profile?.id)
        if (err != null) {
            msg = err
            return
        }
        onSave(n, kids && canKids, avatar)
    }

    PanelCardColumn(maxWidth = if (isTv) 800.dp else 560.dp) {
        PanelTitle(if (profile == null) "Nuevo perfil" else "Editar perfil", scale)
        if (isTv) {
            Row(horizontalArrangement = Arrangement.spacedBy(26.dp)) {
                Column(Modifier.width(270.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        ProfileAvatar(index = avatar, size = 64.dp)
                        Text(
                            text = cleanName(name).ifEmpty { "Nombre del perfil" },
                            color = if (name.isBlank()) OpenTvColors.TextMuted else Color.White,
                            fontSize = (18f * scale).sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    TvKeyboard(
                        value = name,
                        onValueChange = { name = it.take(24); msg = "" },
                        placeholder = "Nombre del perfil",
                        firstKeyFocusRequester = firstFocus,
                        keyHeight = 28.dp,
                        keyFontSize = (12.5f * scale).sp,
                        displayHeight = 32.dp,
                        displayFontSize = (12.5f * scale).sp,
                        gap = 4.dp,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Column(Modifier.weight(1f)) {
                    EditorOptions(avatar, { avatar = it }, kids, { kids = it }, canKids, scale)
                    PanelMessage(msg, scale)
                    EditorButtons(profile == null, canDelete, armed, scale, isTv, ::submit, onCancel) {
                        if (!armed) armed = true else onDelete?.invoke()
                    }
                }
            }
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.padding(bottom = 18.dp),
            ) {
                ProfileAvatar(index = avatar, size = 78.dp)
                NameField(
                    value = name,
                    onValueChange = { name = it.take(24); msg = "" },
                    focusRequester = firstFocus,
                    onDone = { submit() },
                    scale = scale,
                    isTv = false,
                    modifier = Modifier.weight(1f),
                )
            }
            EditorOptions(avatar, { avatar = it }, kids, { kids = it }, canKids, scale)
            PanelMessage(msg, scale)
            EditorButtons(profile == null, canDelete, armed, scale, isTv, ::submit, onCancel) {
                if (!armed) armed = true else onDelete?.invoke()
            }
        }
    }
}

@Composable
private fun EditorOptions(
    avatar: Int,
    onAvatar: (Int) -> Unit,
    kids: Boolean,
    onKids: (Boolean) -> Unit,
    canKids: Boolean,
    scale: Float,
) {
    Text(
        "AVATAR",
        color = Color(0x80FFFFFF),
        fontSize = (11.5f * scale).sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.08.em,
        modifier = Modifier.padding(bottom = 9.dp),
    )
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        PROFILE_AVATARS.indices.chunked(8).forEach { rowIdx ->
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp), modifier = Modifier.fillMaxWidth()) {
                rowIdx.forEach { idx -> AvatarChoice(idx, idx == avatar, Modifier.weight(1f)) { onAvatar(idx) } }
            }
        }
    }
    if (canKids) {
        Spacer(Modifier.height(16.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0x0DFFFFFF))
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Perfil infantil (Kids)", color = Color.White, fontSize = (14.5f * scale).sp, fontWeight = FontWeight.Bold)
                Text("Muestra solo contenido familiar.", color = Color(0x8CFFFFFF), fontSize = (12.5f * scale).sp)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                PanelButton("No", style = BtnStyle.Segment, selected = !kids, scale = scale, onClick = { onKids(false) })
                PanelButton("Sí", style = BtnStyle.Segment, selected = kids, scale = scale, onClick = { onKids(true) })
            }
        }
    }
}

@Composable
private fun EditorButtons(
    isNew: Boolean,
    canDelete: Boolean,
    armed: Boolean,
    scale: Float,
    isTv: Boolean,
    onSave: () -> Unit,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        PanelButton(if (isNew) "Crear" else "Guardar", style = BtnStyle.Primary, scale = scale, onClick = onSave)
        PanelButton("Cancelar", style = BtnStyle.Plain, scale = scale, onClick = onCancel)
        if (canDelete) {
            Spacer(Modifier.weight(1f))
            PanelButton(
                if (armed) (if (isTv) "¿Seguro? Pulsa otra vez" else "¿Seguro? Se borrará su historial") else "Eliminar",
                style = BtnStyle.Danger,
                scale = scale,
                onClick = onDelete,
            )
        }
    }
}

/** One avatar of the picker: selected = white ring + full opacity (PC `ring-[3px] ring-white`). */
@Composable
private fun AvatarChoice(index: Int, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Box(
        modifier = modifier
            .aspectRatio(1f)
            .graphicsLayer {
                val s = if (focused || selected) 1.06f else 1f
                scaleX = s
                scaleY = s
                alpha = if (focused || selected) 1f else 0.75f
            }
            .outerRing(selected || focused, 10.dp, if (focused) 3.dp else 2.dp, gap = if (focused) 2.dp else 0.dp)
            .clip(shape)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
    ) {
        ProfileAvatar(index = index, modifier = Modifier.fillMaxSize())
    }
}

@Composable
private fun PanelTitle(text: String, scale: Float) {
    Text(
        text,
        color = Color.White,
        fontSize = (22f * scale).sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(bottom = 18.dp),
    )
}

@Composable
private fun PanelMessage(msg: String, scale: Float) {
    Box(Modifier.heightIn(min = 20.dp).padding(top = 10.dp, bottom = 4.dp)) {
        if (msg.isNotEmpty()) Text(msg, color = DangerText, fontSize = (13f * scale).sp)
    }
    Spacer(Modifier.height(6.dp))
}

@Composable
private fun NameField(
    value: String,
    onValueChange: (String) -> Unit,
    focusRequester: FocusRequester,
    onDone: () -> Unit,
    scale: Float,
    isTv: Boolean,
    modifier: Modifier = Modifier,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val focusManager = LocalFocusManager.current
    val shape = RoundedCornerShape(12.dp)
    Box(
        contentAlignment = Alignment.CenterStart,
        modifier = modifier
            .height(50.dp)
            .outerRing(focused && isTv, 12.dp, 2.dp)
            .clip(shape)
            .background(OpenTvColors.GlassFill)
            .border(1.dp, if (focused) Color.White else Color(0x26FFFFFF), shape)
            .padding(horizontal = 16.dp),
    ) {
        if (value.isEmpty()) {
            Text("Nombre", color = OpenTvColors.TextMuted, fontSize = (18f * scale).sp, maxLines = 1)
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            interactionSource = interaction,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Words,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { onDone() }),
            textStyle = TextStyle(color = Color.White, fontSize = (18f * scale).sp),
            cursorBrush = SolidColor(Color.White),
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(focusRequester)
                // Remote: up/down leave the field (left/right keep moving the caret).
                .onPreviewKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (e.key) {
                        Key.DirectionDown -> { focusManager.moveFocus(FocusDirection.Down); true }
                        Key.DirectionUp -> { focusManager.moveFocus(FocusDirection.Up); true }
                        else -> false
                    }
                },
        )
    }
}

private enum class BtnStyle { Primary, Plain, Danger, Segment }

/** v1 `.pe2-btn` (+ TV focus ring `0 0 0 2px #0e0e11, 0 0 0 4px #fff`). */
@Composable
private fun PanelButton(
    text: String,
    style: BtnStyle,
    scale: Float,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    val filled = style == BtnStyle.Primary || (style == BtnStyle.Segment && selected)
    val bg = when {
        filled -> Color.White
        focused -> Color(0x1AFFFFFF)
        else -> Color.Transparent
    }
    val fg = when {
        filled -> OpenTvColors.BgCanvas
        style == BtnStyle.Danger -> DangerText
        else -> Color.White
    }
    val borderColor = when {
        filled -> Color.White
        style == BtnStyle.Danger -> DangerBorder
        else -> Color(0x2EFFFFFF)
    }
    val fontSize: TextUnit = (15f * scale).sp
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .outerRing(focused, 10.dp, 2.dp, gap = 2.dp)
            .clip(shape)
            .background(bg)
            .border(1.dp, borderColor, shape)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(
                horizontal = if (style == BtnStyle.Segment) 18.dp else 22.dp,
                vertical = 11.dp,
            ),
    ) {
        Text(
            text,
            color = fg,
            fontSize = fontSize,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            textAlign = TextAlign.Center,
        )
    }
}
