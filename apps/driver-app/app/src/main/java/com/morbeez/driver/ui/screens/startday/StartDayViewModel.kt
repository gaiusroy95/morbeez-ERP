package com.morbeez.driver.ui.screens.startday

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.device.LocationReader
import com.morbeez.driver.data.device.NetworkMonitor
import com.morbeez.driver.data.device.Position
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Where finding the phone's position stands. */
enum class GpsState { NO_PERMISSION, OFF, FINDING, LOCKED, UNAVAILABLE }

data class StartDayUiState(
    val day: DriverDayEntity? = null,
    val trip: TripEntity? = null,
    val stopCount: Int = 0,
    val online: Boolean = true,
    val gps: GpsState = GpsState.FINDING,
    val position: Position? = null,
    val started: Boolean = false,
)

/**
 * Start Day (Driver app V1, D1; client spec §2): the trip the owner planned
 * for today goes on the road with the vehicle's opening KM, the phone's
 * position and the time. Saved on the phone and queued, so it works with no
 * signal; the server checks the KM against the vehicle's last reading again.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class StartDayViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
    private val location: LocationReader,
    network: NetworkMonitor,
) : ViewModel() {
    private val gps = MutableStateFlow(GpsState.FINDING)
    private val position = MutableStateFlow<Position?>(null)
    private val started = MutableStateFlow(false)
    private var locating: Job? = null

    private val tripWithCount = trips.observeActiveTrip().flatMapLatest { trip ->
        if (trip == null) {
            flowOf<Pair<TripEntity?, Int>>(null to 0)
        } else {
            trips.observeStops(trip.id).map<List<*>, Pair<TripEntity?, Int>> { trip to it.size }
        }
    }

    val state: StateFlow<StartDayUiState> = combine(
        trips.observeDay(),
        tripWithCount,
        network.online,
        combine(gps, position) { g, p -> g to p },
        started,
    ) { day, (trip, count), online, (g, p), isStarted ->
        StartDayUiState(day, trip, count, online, g, p, isStarted)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StartDayUiState())

    fun hasLocationPermission() = location.hasPermission()

    /** Looks for the phone's position; again after permission is granted or location switched on. */
    fun locate() {
        when {
            !location.hasPermission() -> gps.value = GpsState.NO_PERMISSION
            !location.isEnabled() -> gps.value = GpsState.OFF
            gps.value == GpsState.LOCKED || locating?.isActive == true -> Unit
            else -> {
                gps.value = GpsState.FINDING
                locating = viewModelScope.launch {
                    location.lastKnown(maxAgeMillis = 2 * 60_000)?.let { position.value = it }
                    location.current(timeoutMillis = 20_000)?.let { position.value = it }
                    gps.value = if (position.value != null) GpsState.LOCKED else GpsState.UNAVAILABLE
                }
            }
        }
    }

    /** Hold-to-start: on the road on this phone at once, sent when there's signal. */
    fun start(openingKm: Double) {
        val trip = state.value.trip ?: return
        if (trip.status != "planned" || started.value) return
        started.value = true
        val at = position.value
        viewModelScope.launch {
            trips.queueStartDay(trip.id, openingKm, at?.latitude, at?.longitude, at?.accuracyMeters)
            SyncWorker.requestNow(appContext)
        }
    }
}
