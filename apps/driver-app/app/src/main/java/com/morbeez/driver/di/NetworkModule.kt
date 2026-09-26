package com.morbeez.driver.di

import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.AuthInterceptor
import com.morbeez.driver.data.remote.TokenAuthenticator
import com.morbeez.driver.data.security.TokenStore
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit
import javax.inject.Singleton
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

// The backend base URL — build-config'd per environment in a real release
// pipeline (dev/staging/prod); hardcoded here since this module is
// structure-and-logic, not a deployment configuration exercise.
private const val BASE_URL = "https://api.morbeez.example/"

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideMoshi(): Moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()

    // A second, un-authenticated Retrofit/OkHttp pair used only by
    // TokenAuthenticator to call /auth/refresh — reusing the authenticated
    // client there would recurse into itself on every 401.
    @Provides
    @Singleton
    fun providePlainApiService(moshi: Moshi): ApiService {
        val client = OkHttpClient.Builder().build()
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(ApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(tokenStore: TokenStore, plainApiService: ApiService): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            // Headers/body are never logged — tokens and cash amounts don't
            // belong in a log line (Driver App Architecture, DRV.12).
            level = HttpLoggingInterceptor.Level.BASIC
        }
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .authenticator(TokenAuthenticator(tokenStore) { plainApiService })
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideApiService(client: OkHttpClient, moshi: Moshi): ApiService {
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
            .create(ApiService::class.java)
    }
}
