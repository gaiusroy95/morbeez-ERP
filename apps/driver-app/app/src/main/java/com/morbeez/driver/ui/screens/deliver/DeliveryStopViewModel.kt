package com.morbeez.driver.ui.screens.deliver

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.device.LocationReader
import com.morbeez.driver.data.device.Position
import com.morbeez.driver.data.local.DeliveryDraft
import com.morbeez.driver.data.local.QrState
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CrateTypeResponse
import com.morbeez.driver.data.remote.dto.DeliveryOutcomeResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
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
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class DeliveryUiState(
    val trip: TripEntity? = null,
    val stop: TripStopEntity? = null,
    val items: List<StopItemResponse> = emptyList(),
    /** Null until the phone's copy has loaded. */
    val draft: DeliveryDraft? = null,
    val crateTypes: List<CrateTypeResponse> = emptyList(),
    /** The delivery to make now; every other one waits its turn. */
    val next: TripStopEntity? = null,
    val position: Position? = null,
    /** A completed stop: what was delivered. */
    val outcome: DeliveryOutcomeResponse? = null,
    /** The last scan was another shop's QR. */
    val wrongQr: Boolean = false,
) {
    val started get() = trip?.deliveryStartedAt != null
    val isNext get() = stop != null && next?.id == stop.id
    val arrived get() = stop?.arrivedAt != null
}

/**
 * A delivery (driver app V1, D3; design sheet screens 9–11): to the shop,
 * the shop's own QR, what left the vehicle line by line, unloaded, photo,
 * crates, hold to complete. Kept on the phone as it's entered (DeliveryDraft);
 * nothing reaches the server until hold-to-complete.
 */
@HiltViewModel
class DeliveryStopViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    savedState: SavedStateHandle,
    private val trips: TripRepository,
    private val location: LocationReader,
) : ViewModel() {
    private val tripId: String = checkNotNull(savedState["tripId"])
    private val stopId: String = checkNotNull(savedState["stopId"])
    private val draft = MutableStateFlow<DeliveryDraft?>(null)
    private val position = MutableStateFlow<Position?>(null)
    private val wrongQr = MutableStateFlow(false)

    init {
        viewModelScope.launch { draft.value = trips.observeDeliveryDraft(stopId).first() ?: DeliveryDraft() }
        if (location.hasPermission()) viewModelScope.launch { position.value = location.lastKnown(maxAgeMillis = 10 * 60_000) }
    }

    val state: StateFlow<DeliveryUiState> = combine(
        trips.observeStops(tripId),
        draft,
        trips.observeDay(),
        trips.observeActiveTrip(),
        combine(position, wrongQr) { p, w -> p to w },
    ) { stops, draft, day, trip, (here, wrong) ->
        val stop = stops.firstOrNull { it.id == stopId }
        val items = stop?.let { trips.itemsOf(it) } ?: emptyList()
        val crateTypes = trips.crateTypesOf(day)
        DeliveryUiState(
            trip = trip,
            stop = stop,
            items = items,
            draft = draft?.let { DeliveryLogic.withItems(it, items, crateTypes, stop?.counterpartyName.orEmpty()) },
            crateTypes = crateTypes,
            next = DeliveryLogic.nextDelivery(stops),
            position = here,
            outcome = stop?.let { trips.deliveryOf(it) },
            wrongQr = wrong,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DeliveryUiState())

    /** Any change to what's entered: kept on the phone at once. */
    fun edit(change: (DeliveryDraft) -> DeliveryDraft) {
        val s = state.value
        val now = s.draft ?: return
        val next = change(now)
        draft.value = next
        viewModelScope.launch { trips.saveDeliveryDraft(tripId, stopId, next) }
    }

    /** Start Trip: the delivery run sets off. */
    fun startDeliveries() {
        viewModelScope.launch {
            trips.queueStartDeliveries(tripId)
            SyncWorker.requestNow(appContext)
        }
    }

    /** At the shop. */
    fun arrive() {
        viewModelScope.launch {
            trips.queueArrive(tripId, stopId)
            SyncWorker.requestNow(appContext)
        }
    }

    /** What the camera read: this shop's QR verifies the delivery; another one blocks it. */
    fun scanned(value: String) {
        if (DeliveryLogic.qrMatches(value, state.value.stop?.partyQrToken)) {
            wrongQr.value = false
            edit { it.copy(qr = QrState.VERIFIED, qrValue = value.trim(), qrNote = null) }
        } else {
            wrongQr.value = true
        }
    }

    /** No QR at the shop, or it won't scan (the client's answer 5: identification only — the delivery goes on). */
    fun notScanned(note: String) {
        wrongQr.value = false
        edit { it.copy(qr = QrState.NOT_SCANNED, qrValue = null, qrNote = note) }
    }

    fun deliveryPhoto(path: String, mimeType: String) {
        viewModelScope.launch { trips.queuePhoto(tripId, stopId, "pod", path, mimeType) }
        edit { it.copy(podPhotos = it.podPhotos + 1) }
    }

    /** The customer's scale, when their weight settles a live-bird line. */
    fun scalePhoto(path: String, mimeType: String) {
        viewModelScope.launch { trips.queuePhoto(tripId, stopId, "weighment", path, mimeType) }
        edit { it.copy(scalePhotos = it.scalePhotos + 1) }
    }

    /** Hold-to-complete: sent when there's signal; the stop shows as delivered straight away. */
    fun complete(onDone: () -> Unit) {
        val s = state.value
        val d = s.draft ?: return
        if (!DeliveryLogic.readinessOf(d, s.items).ready) return
        viewModelScope.launch {
            trips.queueCompleteDelivery(tripId, stopId, DeliveryLogic.requestOf(d, s.items), DeliveryLogic.outcomeOf(d, s.items))
            SyncWorker.requestNow(appContext)
            onDone()
        }
    }
}
