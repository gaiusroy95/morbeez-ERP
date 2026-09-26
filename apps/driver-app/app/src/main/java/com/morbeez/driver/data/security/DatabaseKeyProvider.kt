package com.morbeez.driver.data.security

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Generates and stores the Room database's SQLCipher passphrase — the
 * second of the "two secrets, two mechanisms" split (Driver App
 * Architecture, DRV.10). The passphrase itself lives in the same
 * Keystore-backed store as the session tokens; the encrypted database
 * file is useless without both the phone's hardware key and this value.
 */
@Singleton
class DatabaseKeyProvider @Inject constructor(@ApplicationContext context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "morbeez_driver_db_key",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun getOrCreatePassphrase(): ByteArray {
        val existing = prefs.getString(KEY_PASSPHRASE, null)
        if (existing != null) {
            return android.util.Base64.decode(existing, android.util.Base64.NO_WRAP)
        }
        val generated = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val encoded = android.util.Base64.encodeToString(generated, android.util.Base64.NO_WRAP)
        prefs.edit().putString(KEY_PASSPHRASE, encoded).apply()
        return generated
    }

    private companion object {
        const val KEY_PASSPHRASE = "sqlcipher_passphrase"
    }
}
