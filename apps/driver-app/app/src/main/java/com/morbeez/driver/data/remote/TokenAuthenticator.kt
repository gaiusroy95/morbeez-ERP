package com.morbeez.driver.data.remote

import com.morbeez.driver.data.remote.dto.RefreshRequest
import com.morbeez.driver.data.security.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import retrofit2.HttpException

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

    // One refresh at a time: parallel 401s would otherwise all present the
    // same refresh token, and the server treats a rotated token coming back
    // as theft (Security Audit SA-04, SA-12).
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null // already retried once — give up

        val sentToken = response.request.header("Authorization")?.removePrefix("Bearer ")
        synchronized(lock) {
            // Another request refreshed while this one waited: just use its token.
            val current = tokenStore.accessToken
            if (current != null && current != sentToken) return withToken(response, current)

            val refreshToken = tokenStore.refreshToken ?: return null
            val newTokens = runBlocking {
                runCatching { plainApiProvider().refresh(RefreshRequest(refreshToken)) }
            }.getOrElse { error ->
                // Only a definite refusal ends the session. A timeout or a dropped
                // connection keeps it, so a driver out of signal isn't signed out
                // mid-trip; the next sync tries again (Security Audit SA-12).
                if (error is HttpException && error.code() in setOf(400, 401)) tokenStore.clear()
                return null
            }

            tokenStore.accessToken = newTokens.accessToken
            tokenStore.refreshToken = newTokens.refreshToken
            return withToken(response, newTokens.accessToken)
        }
    }

    private fun withToken(response: Response, accessToken: String): Request =
        response.request.newBuilder()
            .header("Authorization", "Bearer $accessToken")
            .build()

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
