package com.morbeez.driver.ui.screens.route

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class RouteUiState(
    val trip: TripEntity? = null,
    val stops: List<TripStopEntity> = emptyList(),
    val isSyncing: Boolean = false,
)

/**
 * Renders the server-computed stop sequence and lets the driver report
 * deviations — the optimizer itself runs server-side (System Architecture,
 * MOB.5). This screen is Room-only (Driver App Architecture, DRV.1); it
 * never calls the network directly, only triggers a sync pass.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class RouteViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val tripRepository: TripRepository,
) : ViewModel() {

    // Syncing while the requested pass is waiting for a network or running.
    private val isSyncing = WorkManager.getInstance(appContext)
        .getWorkInfosForUniqueWorkFlow(SyncWorker.NOW_WORK_NAME)
        .map { infos -> infos.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING } }

    private val tripWithStops = tripRepository.observeActiveTrip().flatMapLatest { trip ->
        if (trip == null) {
            flowOf(RouteUiState(trip = null, stops = emptyList()))
        } else {
            tripRepository.observeStops(trip.id).map { stops -> RouteUiState(trip = trip, stops = stops) }
        }
    }

    val state: StateFlow<RouteUiState> = combine(tripWithStops, isSyncing) { base, syncing ->
        base.copy(isSyncing = syncing)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RouteUiState())

    /**
     * Refresh goes through the same single sync as everything else. It used
     * to also pull the route directly, which could land on top of actions
     * not yet sent (DRV.9) and doubled the traffic (Performance Audit PA-11).
     */
    fun requestSync() {
        SyncWorker.requestNow(appContext)
    }

    fun skipStop(stopId: String) {
        val tripId = state.value.trip?.id ?: return
        viewModelScope.launch { tripRepository.queueSkipStop(tripId, stopId) }
    }
}
