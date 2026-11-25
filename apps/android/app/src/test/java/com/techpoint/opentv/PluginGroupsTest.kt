package com.techpoint.opentv

import com.techpoint.opentv.core.addons.PluginCatalogs
import com.techpoint.opentv.core.model.InstalledPlugin
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as the desktop `catalogs.test.ts` (`isLiveTvPlugin`). */
class PluginGroupsTest {
    private fun plugin(vararg types: String) =
        InstalledPlugin(id = "p", name = "P", url = "https://example.com/manifest.json", types = types.toList())

    @Test
    fun channelOnlyPluginsAreLiveTv() {
        assertTrue(PluginCatalogs.isLiveTvPlugin(plugin("tv")))
        assertTrue(PluginCatalogs.isLiveTvPlugin(plugin("channel", "TV")))
    }

    @Test
    fun movieSeriesAndUntypedPluginsAreVod() {
        assertFalse(PluginCatalogs.isLiveTvPlugin(plugin("movie", "series")))
        assertFalse(PluginCatalogs.isLiveTvPlugin(plugin("movie", "tv")))
        assertFalse(PluginCatalogs.isLiveTvPlugin(plugin()))
    }

    @Test
    fun bundledPluginsAreNeverLiveTv() {
        assertFalse(PluginCatalogs.BuiltinPlugins.any { PluginCatalogs.isLiveTvPlugin(it) })
    }
}
