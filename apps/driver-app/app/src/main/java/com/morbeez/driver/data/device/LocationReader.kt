package com.morbeez.driver.data.device

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/** Where the phone is: degrees, and how sure (metres), when the phone says. */
data class Position(val latitude: Double, val longitude: Double, val accuracyMeters: Double?)

/**
 * The phone's location, from Android's own location service — no Google
 * Play services needed. Start Day records it; the Dashboard uses it for the
 * distance to the next stop. Never blocks the driver: no permission, location
 * off or no fix all just mean no position.
 */
@Singleton
class LocationReader @Inject constructor(@ApplicationContext private val context: Context) {
    private val manager: LocationManager? get() = context.getSystemService(LocationManager::class.java)

    fun hasPermission(): Boolean =
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    /** Location switched on in the phone's settings. */
    fun isEnabled(): Boolean = manager?.let { LocationManagerCompat.isLocationEnabled(it) } == true

    /** A fresh fix, or within [timeoutMillis] the last one the phone had (if recent); null when there's none. */
    @SuppressLint("MissingPermission")
    suspend fun current(timeoutMillis: Long = 20_000): Position? {
        val lm = manager ?: return null
        if (!hasPermission() || !isEnabled()) return null
        val provider = PROVIDERS.firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) } ?: return null
        val fresh = withTimeoutOrNull(timeoutMillis) {
            suspendCancellableCoroutine<Location?> { cont ->
                val signal = CancellationSignal()
                cont.invokeOnCancellation { signal.cancel() }
                LocationManagerCompat.getCurrentLocation(lm, provider, signal, ContextCompat.getMainExecutor(context)) { location ->
                    if (cont.isActive) cont.resume(location)
                }
            }
        }
        return fresh?.toPosition() ?: lastKnown(maxAgeMillis = 5 * 60_000)
    }

    /** The newest fix the phone already has, no older than [maxAgeMillis]. */
    @SuppressLint("MissingPermission")
    fun lastKnown(maxAgeMillis: Long = 30 * 60_000): Position? {
        val lm = manager ?: return null
        if (!hasPermission()) return null
        val now = System.currentTimeMillis()
        return PROVIDERS
            .mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .filter { now - it.time <= maxAgeMillis }
            .maxByOrNull { it.time }
            ?.toPosition()
    }

    private fun Location.toPosition() = Position(latitude, longitude, if (hasAccuracy()) accuracy.toDouble() else null)

    private companion object {
        val PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
    }
}
