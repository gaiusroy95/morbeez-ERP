package com.morbeez.driver.data.repository

import com.morbeez.driver.data.local.AppDatabase
import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.LoginRequest
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
