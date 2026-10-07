package com.morbeez.driver.data.security

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Device-bound session storage (Driver App Architecture, DRV.10-11). Backed
 * by a key generated inside the Android Keystore that never leaves the
 * device's secure hardware — extracting the app's data directory yields an
 * encrypted file, not a readable token. Losing a device is handled by
 * revoking its session server-side (identity.auth_session), not by
 * anything this class does locally.
 */
@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "morbeez_driver_session",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_ACCESS_TOKEN, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_REFRESH_TOKEN, value).apply()

    val deviceId: String
        get() = prefs.getString(KEY_DEVICE_ID, null) ?: generateAndStoreDeviceId()

    /**
     * The mobile number that has a PIN on this phone (the PIN itself never
     * leaves the server, and works only with this phone's [deviceId]).
     * Survives signing out: that's when the PIN is for.
     */
    var pinLogin: String?
        get() = prefs.getString(KEY_PIN_LOGIN, null)
        set(value) = prefs.edit().putString(KEY_PIN_LOGIN, value).apply()

    /** Who signed in last, so a PIN set right after a password sign-in knows whose it is. */
    var lastLogin: String?
        get() = prefs.getString(KEY_LAST_LOGIN, null)
        set(value) = prefs.edit().putString(KEY_LAST_LOGIN, value).apply()

    fun isLoggedIn(): Boolean = accessToken != null

    fun clear() {
        prefs.edit().remove(KEY_ACCESS_TOKEN).remove(KEY_REFRESH_TOKEN).apply()
    }

    private fun generateAndStoreDeviceId(): String {
        val id = java.util.UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        return id
    }

    private companion object {
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_PIN_LOGIN = "pin_login"
        const val KEY_LAST_LOGIN = "last_login"
    }
}
