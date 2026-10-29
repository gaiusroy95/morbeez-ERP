package com.morbeez.driver.data.device

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Online or not, for the status header: a network that actually reaches the
 * internet (validated), not just a Wi-Fi or mobile signal. The sync engine
 * doesn't depend on it — WorkManager waits for a network on its own.
 */
@Singleton
class NetworkMonitor @Inject constructor(@ApplicationContext private val context: Context) {
    val online: Flow<Boolean> = callbackFlow {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        if (cm == null) {
            trySend(true)
            awaitClose { }
            return@callbackFlow
        }
        fun reaches(caps: NetworkCapabilities?) =
            caps != null &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                trySend(reaches(caps))
            }

            override fun onLost(network: Network) {
                trySend(false)
            }
        }
        trySend(reaches(cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }))
        cm.registerDefaultNetworkCallback(callback)
        awaitClose { cm.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()
}
