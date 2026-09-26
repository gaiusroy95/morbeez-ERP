package com.morbeez.driver.data.remote

import com.morbeez.driver.data.security.TokenStore
import okhttp3.Interceptor
import okhttp3.Response

/** Attaches the current session's access token to every request — constructed directly by NetworkModule, not Hilt-injected on its own. */
class AuthInterceptor(private val tokenStore: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenStore.accessToken
        val request = chain.request().let { original ->
            if (token == null) original
            else original.newBuilder().addHeader("Authorization", "Bearer $token").build()
        }
        return chain.proceed(request)
    }
}
