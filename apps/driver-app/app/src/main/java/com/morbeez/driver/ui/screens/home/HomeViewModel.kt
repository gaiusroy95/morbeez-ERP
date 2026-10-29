package com.morbeez.driver.ui.screens.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.morbeez.driver.data.device.LocationReader
import com.morbeez.driver.data.device.NetworkMonitor
import com.morbeez.driver.data.device.Position
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.DeliveryOutcomeResponse
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.ui.screens.deliver.DeliveryLogic
import com.morbeez.driver.ui.screens.deliver.StockLine
import com.morbeez.driver.data.remote.dto.TripVehicleStockResponse
import com.morbeez.driver.data.repository.AuthRepository
import com.morbeez.driver.data.repository.LogoutResult
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Online, syncing, and what's waiting to reach the office: the status header. */
data class LinkState(
    val online: Boolean = true,
    val syncing: Boolean = false,
    val waiting: Int = 0,
    val failed: Int = 0,
)

data class HomeUiState(
    val day: DriverDayEntity? = null,
    val trip: TripEntity? = null,
    val stops: List<TripStopEntity> = emptyList(),
    val stock: TripVehicleStockResponse? = null,
    val link: LinkState = LinkState(),
    val position: Position? = null,
    /** Completed farm stops, by stop id: what was loaded and rejected (D2). */
    val farms: Map<String, FarmStopOutcomeResponse> = emptyMap(),
    /** Completed deliveries, by stop id (D3). */
    val deliveries: Map<String, DeliveryOutcomeResponse> = emptyMap(),
    /** What's on the vehicle now, by the phone's reckoning (D3). */
    val stockLines: List<StockLine> = emptyList(),
)

/**
 * The driver's home (Driver app V1, D1): the shell's status header, the
 * Dashboard, and the Procurement and Delivery lists. Room only (Driver App
 * Architecture, DRV.1) — what the server last said, plus anything done on
 * this phone since.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class HomeViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
    private val auth: AuthRepository,
    private val location: LocationReader,
    network: NetworkMonitor,
) : ViewModel() {
    private val position = MutableStateFlow<Position?>(null)

    private val isSyncing = WorkManager.getInstance(appContext)
        .getWorkInfosForUniqueWorkFlow(SyncWorker.NOW_WORK_NAME)
        .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }

    private val link = combine(network.online, isSyncing, trips.observePendingCount(), trips.observeFailedOperations()) { online, syncing, waiting, failed ->
        LinkState(online, syncing, waiting + failed.size, failed.size)
    }

    private val tripWithStops = trips.observeActiveTrip().flatMapLatest { trip ->
        if (trip == null) {
            flowOf<Pair<TripEntity?, List<TripStopEntity>>>(null to emptyList())
        } else {
            trips.observeStops(trip.id).map<List<TripStopEntity>, Pair<TripEntity?, List<TripStopEntity>>> { trip to it }
        }
    }

    val state: StateFlow<HomeUiState> = combine(trips.observeDay(), tripWithStops, link, position) { day, (trip, stops), link, position ->
        val farms = stops.mapNotNull { s -> trips.farmOf(s)?.let { s.id to it } }.toMap()
        val deliveries = stops.mapNotNull { s -> trips.deliveryOf(s)?.let { s.id to it } }.toMap()
        val stock = trips.stockOf(day)
        HomeUiState(day, trip, stops, stock, link, position, farms, deliveries, DeliveryLogic.stockOf(stock, stops, farms, deliveries) { trips.itemsOf(it) })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUiState())

    /** Where the phone is, for the distance to the next stop; quietly nothing without permission. */
    fun refreshPosition() {
        if (!location.hasPermission()) return
        viewModelScope.launch {
            location.lastKnown(maxAgeMillis = 10 * 60_000)?.let { position.value = it }
            location.current(timeoutMillis = 15_000)?.let { position.value = it }
        }
    }

    fun requestSync() {
        SyncWorker.requestNow(appContext)
    }

    /** Start Trip (D3): the delivery run sets off. */
    fun startDeliveries() {
        val trip = state.value.trip ?: return
        viewModelScope.launch {
            trips.queueStartDeliveries(trip.id)
            SyncWorker.requestNow(appContext)
        }
    }

    /** Signs out; while anything is unsynced it refuses unless [discardUnsynced] (see [AuthRepository.logout]). */
    fun signOut(discardUnsynced: Boolean, onResult: (LogoutResult) -> Unit) {
        viewModelScope.launch { onResult(auth.logout(discardUnsynced)) }
    }
}
