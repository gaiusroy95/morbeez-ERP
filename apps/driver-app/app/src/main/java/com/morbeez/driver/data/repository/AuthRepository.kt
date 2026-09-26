package com.morbeez.driver.data.repository

import com.morbeez.driver.data.local.AppDatabase
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
) {
    val isLoggedIn: Boolean get() = tokenStore.isLoggedIn()

    suspend fun login(email: String, password: String) {
        val tokens = api.login(LoginRequest(email, password))
        tokenStore.accessToken = tokens.accessToken
        tokenStore.refreshToken = tokens.refreshToken
    }

    /** Clears the session locally; the server-side session is revoked separately by logout(). */
    suspend fun logout() {
        val refreshToken = tokenStore.refreshToken
        tokenStore.clear()
        // Every table here holds only this driver's own trip data — nothing
        // worth keeping once they've signed out (Driver App Architecture, DRV.13).
        database.clearAllTables()
        if (refreshToken != null) {
            runCatching { api.logout(RefreshRequest(refreshToken)) }
        }
    }
}
