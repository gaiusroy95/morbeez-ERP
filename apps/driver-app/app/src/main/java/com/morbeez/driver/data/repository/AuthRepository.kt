package com.morbeez.driver.data.repository

import com.morbeez.driver.data.local.AppDatabase
import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.LoginRequest
import com.morbeez.driver.data.remote.dto.PinLoginRequest
import com.morbeez.driver.data.remote.dto.PreferencesBody
import com.morbeez.driver.data.remote.dto.SetPinRequest
import com.morbeez.driver.data.remote.dto.RefreshRequest
import com.morbeez.driver.data.security.TokenStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: ApiService,
    private val tokenStore: TokenStore,
    private val database: AppDatabase,
    private val pendingOperationDao: PendingOperationDao,
    private val pendingPhotoDao: PendingPhotoDao,
) {
    val isLoggedIn: Boolean get() = tokenStore.isLoggedIn()

    suspend fun login(login: String, password: String) {
        val tokens = api.login(LoginRequest(login, password, tokenStore.deviceId))
        tokenStore.accessToken = tokens.accessToken
        tokenStore.refreshToken = tokens.refreshToken
        tokenStore.lastLogin = login
    }

    /** The number with a PIN on this phone, or null: then it's the password. */
    val pinLogin: String? get() = tokenStore.pinLogin

    /** Driver PIN on their own registered phone (client Q&A: pilot scope). */
    suspend fun loginWithPin(pin: String) {
        val login = tokenStore.pinLogin ?: error("No PIN on this phone")
        val tokens = api.pinLogin(PinLoginRequest(login, tokenStore.deviceId, pin))
        tokenStore.accessToken = tokens.accessToken
        tokenStore.refreshToken = tokens.refreshToken
        tokenStore.lastLogin = login
    }

    /** Sets the PIN for this phone, for the person signed in now. */
    suspend fun setPin(pin: String) {
        api.setPin(SetPinRequest(tokenStore.deviceId, pin))
        tokenStore.pinLogin = tokenStore.lastLogin
    }

    /**
     * Keeps this person's language on the server too (client Q&A: chosen per
     * user). Best effort — the phone's own choice is what the app uses.
     */
    suspend fun saveLanguage(code: String) {
        if (tokenStore.isLoggedIn()) runCatching { api.setPreferences(PreferencesBody(code)) }
    }

    /** The language this person chose before, on any device; null when unreachable. */
    suspend fun serverLanguage(): String? = runCatching { api.getPreferences().language }.getOrNull()

    /** After too many wrong PINs the server switched it off; the password it is. */
    fun forgetPin() {
        tokenStore.pinLogin = null
    }

    /** Collections, expenses, stop updates and photos recorded here that haven't reached the server. */
    suspend fun unsyncedCount(): Int = pendingOperationDao.count() + pendingPhotoDao.count()

    /**
     * Signs out and wipes this phone's trip data. Refuses while anything is
     * still waiting to sync unless [discardUnsynced] is set: the queue holds
     * cash the driver collected, and wiping it would erase the only record
     * of it (Security Audit SA-12). The screen offering sign-out shows
     * [unsyncedCount] and asks before passing true.
     */
    suspend fun logout(discardUnsynced: Boolean = false): LogoutResult {
        val waiting = unsyncedCount()
        if (waiting > 0 && !discardUnsynced) return LogoutResult.UnsyncedWork(waiting)
        val refreshToken = tokenStore.refreshToken
        tokenStore.clear()
        // Every table here holds only this driver's own trip data — nothing
        // worth keeping once they've signed out (Driver App Architecture, DRV.13).
        database.clearAllTables()
        if (refreshToken != null) {
            runCatching { api.logout(RefreshRequest(refreshToken)) }
        }
        return LogoutResult.SignedOut
    }
}

sealed interface LogoutResult {
    data object SignedOut : LogoutResult
    data class UnsyncedWork(val count: Int) : LogoutResult
}
