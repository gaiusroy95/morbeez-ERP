package com.morbeez.driver.ui.screens.collect

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** The trip's collections, as this phone reckons them. */
data class CollectionsUiState(
    val trip: TripEntity? = null,
    val stops: List<TripStopEntity> = emptyList(),
    val rows: List<CollectRow> = emptyList(),
    val collected: CollectedByMethod = CollectionsLogic.collectedOf(null, emptyList()),
    /** The office's count is from before this phone's last deliveries. */
    val refreshedAt: Long? = null,
) {
    val pending get() = CollectionsLogic.pendingOf(rows)
    val deliveriesDone get() = stops.any { it.stopType == "delivery" } && stops.none { it.stopType == "delivery" && it.status == "pending" }
}

/** The collections view, from Room only: the office's last list, and what this phone has collected or disputed since. */
@OptIn(ExperimentalCoroutinesApi::class)
fun collectionsOf(trips: TripRepository): Flow<CollectionsUiState> {
    val tripWithStops = trips.observeActiveTrip().flatMapLatest { trip ->
        if (trip == null) {
            flowOf<Pair<TripEntity?, List<TripStopEntity>>>(null to emptyList())
        } else {
            trips.observeStops(trip.id).map<List<TripStopEntity>, Pair<TripEntity?, List<TripStopEntity>>> { trip to it }
        }
    }
    return combine(trips.observeDay(), tripWithStops, trips.observeQueuedCollections(), trips.observeQueuedDisputes()) { day, (trip, stops), queued, disputes ->
        val board = trips.collectionsOf(day)?.takeIf { it.tripId == trip?.id }
        CollectionsUiState(
            trip = trip,
            stops = stops,
            rows = CollectionsLogic.rowsOf(board, stops, queued, disputes),
            collected = CollectionsLogic.collectedOf(board, queued),
            refreshedAt = day?.refreshedAt,
        )
    }
}

@HiltViewModel
class CollectionsViewModel @Inject constructor(trips: TripRepository) : ViewModel() {
    val state: StateFlow<CollectionsUiState> = collectionsOf(trips).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CollectionsUiState())
}

/** Recording a payment from one customer (design sheet screen 16). */
@HiltViewModel
class RecordCollectionViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    savedState: SavedStateHandle,
    private val trips: TripRepository,
) : ViewModel() {
    private val tripId: String = checkNotNull(savedState["tripId"])
    val stopId: String = checkNotNull(savedState["stopId"])
    val state: StateFlow<CollectionsUiState> = collectionsOf(trips).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CollectionsUiState())
    private val _disputeSent = MutableStateFlow(false)
    /** The last dispute went to the owner. */
    val disputeSent: StateFlow<Boolean> = _disputeSent

    /** Payment proof: queued for upload at once. */
    fun proofPhoto(path: String, mimeType: String) {
        viewModelScope.launch { trips.queuePhoto(tripId, stopId, "payment", path, mimeType) }
    }

    /** Queued, sent when there's signal: cash goes into what the driver hands over; UPI and transfers don't. */
    fun receive(amount: Double, method: String, reference: String?, payerName: String?, notes: String?, onDone: () -> Unit) {
        viewModelScope.launch {
            trips.queueCollection(tripId, stopId, amount, method, notes?.trim()?.ifBlank { null }, reference, payerName)
            SyncWorker.requestNow(appContext)
            onDone()
        }
    }

    /** A disputed amount goes to the owner — the driver never writes a balance off (client spec §21). */
    fun dispute(amount: Double, reason: String) {
        viewModelScope.launch {
            trips.queueDispute(tripId, stopId, amount, reason)
            SyncWorker.requestNow(appContext)
            _disputeSent.value = true
        }
    }
}
