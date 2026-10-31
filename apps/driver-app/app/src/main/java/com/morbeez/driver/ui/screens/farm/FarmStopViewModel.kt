package com.morbeez.driver.ui.screens.farm

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.device.LocationReader
import com.morbeez.driver.data.device.Position
import com.morbeez.driver.data.local.Decision
import com.morbeez.driver.data.local.FarmDraft
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CrewOptionResponse
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.data.repository.QueueRepository
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class FarmUiState(
    val stop: TripStopEntity? = null,
    val items: List<StopItemResponse> = emptyList(),
    /** Null until the phone's copy has loaded. */
    val draft: FarmDraft? = null,
    val crew: List<CrewOptionResponse> = emptyList(),
    /** Delegation level on the trip; buying from farmers needs 3 (null: not known yet — the server decides). */
    val authorityLevel: Int? = null,
    val position: Position? = null,
    /** A completed stop: what was accepted and rejected. */
    val outcome: FarmStopOutcomeResponse? = null,
) {
    val canBuy get() = authorityLevel == null || authorityLevel >= 3
    val arrived get() = stop?.arrivedAt != null
}

/**
 * The farmer stop (driver app V1, D2; design sheet screens 4–7): accept or
 * reject each product, pack and weigh, load, hold to complete. Everything
 * entered is kept on the phone as it's typed (FarmDraft), so the visit
 * survives the app closing; nothing reaches the server until hold-to-complete.
 */
@HiltViewModel
class FarmStopViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    savedState: SavedStateHandle,
    private val trips: TripRepository,
    private val location: LocationReader,
    queue: QueueRepository,
) : ViewModel() {
    private val tripId: String = checkNotNull(savedState["tripId"])
    private val stopId: String = checkNotNull(savedState["stopId"])

    /** What the office said, if it refused something done at this stop (DRV.8, D8). */
    val refused: StateFlow<String?> = queue.observeRefusedStops().map { it[stopId] }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    private val draft = MutableStateFlow<FarmDraft?>(null)
    private val position = MutableStateFlow<Position?>(null)

    init {
        viewModelScope.launch { draft.value = trips.observeDraft(stopId).first() ?: FarmDraft() }
        if (location.hasPermission()) viewModelScope.launch { position.value = location.lastKnown(maxAgeMillis = 10 * 60_000) }
    }

    private val stop = trips.observeStops(tripId).map { stops -> stops.firstOrNull { it.id == stopId } }

    val state: StateFlow<FarmUiState> = combine(
        stop,
        draft,
        trips.observeDay(),
        trips.observeActiveTrip(),
        position,
    ) { stop, draft, day, trip, here ->
        val items = stop?.let { trips.itemsOf(it) } ?: emptyList()
        FarmUiState(
            stop = stop,
            items = items,
            draft = draft?.let { FarmLogic.withItems(it, items) },
            crew = trips.crewOf(day),
            authorityLevel = trip?.authorityLevel,
            position = here,
            outcome = stop?.let { trips.farmOf(it) },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FarmUiState())

    /** Any change to what's entered: kept on the phone at once. */
    fun edit(change: (FarmDraft) -> FarmDraft) {
        val now = draft.value ?: return
        val next = change(FarmLogic.withItems(now, state.value.items))
        draft.value = next
        viewModelScope.launch { trips.saveDraft(tripId, stopId, next) }
    }

    /** Start pickup: the driver reached the farm. */
    fun arrive() {
        viewModelScope.launch {
            trips.queueArrive(tripId, stopId)
            SyncWorker.requestNow(appContext)
        }
    }

    /** A photo of the load: queued for upload at once. */
    fun loadPhoto(path: String, mimeType: String) {
        viewModelScope.launch { trips.queuePhoto(tripId, stopId, "load", path, mimeType) }
        edit { it.copy(loadPhotos = it.loadPhotos + 1) }
    }

    /** Why a product was refused, photographed; it names the product. */
    fun rejectionPhoto(productId: String, path: String, mimeType: String) {
        viewModelScope.launch { trips.queuePhoto(tripId, stopId, "rejection", path, mimeType, productId) }
        edit { d -> d.copy(lines = d.lines.map { if (it.productId == productId) it.copy(rejectionPhoto = true) else it }) }
    }

    /** Hold-to-complete: sent when there's signal; the stop shows as done straight away. */
    fun complete(onDone: () -> Unit) {
        val s = state.value
        val d = s.draft ?: return
        if (!FarmLogic.readinessOf(d, s.items).ready) return
        viewModelScope.launch {
            val loads = d.lines.any { it.decision == Decision.ACCEPTED }
            trips.queueCompleteFarmStop(
                tripId = tripId,
                stopId = stopId,
                lines = FarmLogic.requestOf(d, s.items),
                packerId = if (loads) d.packerId else null,
                loaderId = if (loads) FarmLogic.loaderOf(d) else null,
                outcome = FarmLogic.outcomeOf(d, s.items, s.crew),
            )
            SyncWorker.requestNow(appContext)
            onDone()
        }
    }
}
