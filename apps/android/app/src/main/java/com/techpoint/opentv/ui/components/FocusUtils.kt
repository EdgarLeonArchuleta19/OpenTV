package com.techpoint.opentv.ui.components

import androidx.compose.foundation.focusGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged

/**
 * Attaches [requester] only while [active], without ever adding/removing the modifier itself.
 * Toggling `if (x) Modifier.focusRequester(r) else Modifier` shifts the modifier chain and
 * recreates the focus node, which drops focus from the element the user is on.
 */
@Composable
fun Modifier.stableFocusRequester(active: Boolean, requester: FocusRequester): Modifier {
    val own = remember { FocusRequester() }
    return this.focusRequester(if (active) requester else own)
}

/**
 * Remembers the last focused element of a screen area (Home content, a Settings panel…)
 * without recomposing anything, so a side menu can send focus straight back to it.
 * [last] is cleared when that element leaves the composition, so it never points to a
 * detached node (requesting focus on one would throw).
 */
class FocusMemory {
    var last: FocusRequester? = null
        internal set

    /** The remembered element, or [fallback] when nothing is remembered. */
    fun target(fallback: FocusRequester = FocusRequester.Default): FocusRequester = last ?: fallback

    fun clear() {
        last = null
    }
}

/** The [FocusMemory] that focusable building blocks below register with (null = none). */
val LocalFocusMemory = staticCompositionLocalOf<FocusMemory?> { null }

/**
 * Registers the next focus target (place it right before `clickable`/`focusable`) with
 * [memory] (default: [LocalFocusMemory]) every time it gains focus.
 */
@Composable
fun Modifier.rememberFocus(memory: FocusMemory? = LocalFocusMemory.current): Modifier {
    val mem = memory ?: return this
    val fr = remember { FocusRequester() }
    DisposableEffect(mem, fr) {
        onDispose { if (mem.last === fr) mem.last = null }
    }
    return this
        .focusRequester(fr)
        .onFocusChanged { if (it.isFocused) mem.last = fr }
}

/**
 * TV pivot for horizontal card rows: keeps the focused card centred in the row (parent and
 * child fraction 0.5). The lazy list clamps the scroll, so the first card stays aligned at the
 * start padding and the last one at the end; the focused card never slides under the side
 * rail, which is what let ← escape to the menu before reaching the first poster.
 * Stateless object: no allocation per row (cheap on a 1 GB Fire TV).
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
object TvCenterBringIntoViewSpec : androidx.compose.foundation.gestures.BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float =
        offset - (containerSize - size) / 2f
}

/** Provides [TvCenterBringIntoViewSpec] to the lazy row(s) in [content]. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun TvCenteredRowScope(content: @Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.foundation.gestures.LocalBringIntoViewSpec provides TvCenterBringIntoViewSpec,
        content = content,
    )
}

/**
 * Where ← should go when it leaves a horizontal group of controls (a settings row, a tab
 * strip…). Provided by screens with a side menu, so ← from the first control of *any* row
 * returns to the menu instead of jumping to a control of another row further left.
 */
val LocalLeftExit = staticCompositionLocalOf<(() -> FocusRequester)?> { null }

/**
 * Makes this layout a focus group whose ← exit goes to [LocalLeftExit] (when provided).
 * Moves inside the group (between options of the same row) are unaffected.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun Modifier.leftExitGroup(): Modifier {
    val exit = LocalLeftExit.current ?: return this
    return this
        .focusProperties {
            this.exit = { dir -> if (dir == FocusDirection.Left) exit() else FocusRequester.Default }
        }
        .focusGroup()
}
