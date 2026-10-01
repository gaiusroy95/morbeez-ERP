package com.morbeez.driver.data.mode

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** The two apps this one install holds: the owner's web app, and the driver's own screens. */
enum class AppMode { OWNER, DRIVER }

/**
 * Which app this phone opened last, so the next launch goes straight there:
 * in a small business the owner and each driver have phones of their own.
 * The launcher is one back-press away for the rare switch. Not a secret —
 * what either mode may do is decided by the server for the account that
 * signs in, never by this choice — so plain preferences are enough.
 */
@Singleton
class AppModeStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs = context.getSharedPreferences("morbeez_app_mode", Context.MODE_PRIVATE)

    var lastMode: AppMode?
        get() = prefs.getString(KEY_MODE, null)?.let { runCatching { AppMode.valueOf(it) }.getOrNull() }
        set(value) = prefs.edit().putString(KEY_MODE, value?.name).apply()

    private companion object {
        const val KEY_MODE = "last_mode"
    }
}
