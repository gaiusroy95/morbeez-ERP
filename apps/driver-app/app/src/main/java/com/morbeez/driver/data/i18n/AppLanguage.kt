package com.morbeez.driver.data.i18n

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * The language this phone's app speaks (client Q&A: English, Malayalam,
 * Kannada, Tamil, chosen per user). Kept in plain preferences — it's a
 * display choice, not a secret — and read before Hilt exists, from
 * attachBaseContext, which is why this is an object and not an injected
 * store. Owner mode gets the same choice through the owner web app's
 * `mz_lang` cookie (OwnerActivity).
 */
object AppLanguage {
    /** Code → the language's name in its own script, as the picker shows it. */
    val CHOICES: List<Pair<String, String>> = listOf(
        "en" to "English",
        "ml" to "മലയാളം",
        "kn" to "ಕನ್ನಡ",
        "ta" to "தமிழ்",
    )

    private const val PREFS = "morbeez_settings"
    private const val KEY = "language"

    /** The chosen code, or null when nobody has chosen (the phone's own language then decides). */
    fun chosen(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)

    /** What's in effect: the choice, else the phone's language if we speak it, else English. */
    fun current(context: Context): String =
        chosen(context) ?: Locale.getDefault().language.takeIf { code -> CHOICES.any { it.first == code } } ?: "en"

    fun choose(context: Context, code: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, code).apply()
    }

    /** [base] with the chosen language applied — for attachBaseContext and for text built outside a screen. */
    fun wrap(base: Context): Context {
        val code = chosen(base) ?: return base
        val locale = Locale(code)
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        return base.createConfigurationContext(config)
    }
}
