package com.morbeez.driver.data.remote

import com.morbeez.driver.data.remote.dto.RefreshRequest
import com.morbeez.driver.data.security.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * A 401 means the access token expired mid-trip, not that the driver is
 * suddenly unauthorized — this transparently refreshes once and retries,
 * so a background sync doesn't surface a confusing auth error for what is
 * really just a routine token rotation. If the refresh token itself is
 * rejected (revoked — the phone was reported lost, Driver App Architecture
 * DRV.11), this gives up and the caller's normal error handling routes
 * back to Login.
 */
class TokenAuthenticator(
    private val tokenStore: TokenStore,
    private val plainApiProvider: () -> ApiService,
) : Authenticator {

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null // already retried once — give up

        val refreshToken = tokenStore.refreshToken ?: return null
        val newTokens = runBlocking {
            runCatching { plainApiProvider().refresh(RefreshRequest(refreshToken)) }.getOrNull()
        } ?: run {
            tokenStore.clear()
            return null
        }

        tokenStore.accessToken = newTokens.accessToken
        tokenStore.refreshToken = newTokens.refreshToken

        return response.request.newBuilder()
            .header("Authorization", "Bearer ${newTokens.accessToken}")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}
