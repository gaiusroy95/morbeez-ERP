package com.morbeez.driver.ui.screens.delivery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.remote.dto.DeliveryLineMeasure
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Delivery confirmation: proof of delivery — triggers Delivery Completed
 * on sync (Event Catalog). recipientName is always required; either a
 * signature or a 'pod'-type photo already captured on this stop satisfies
 * proof (the backend enforces this same rule — Driver App Architecture,
 * DRV.6 — this screen just can't submit without one locally either, so a
 * driver isn't told "success" only to have the sync pass reject it later).
 *
 * Live birds and eggs (client Q&A): the customer's scale weight, when they
 * weigh, settles a live-bird line; broken eggs come off an egg line. Both
 * optional — the farm weight and the order stand otherwise.
 */
@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val tripRepository: TripRepository,
) : ViewModel() {

    private val _measurable = MutableStateFlow<List<StopItemResponse>>(emptyList())
    /** The lines a customer-end measure applies to: live birds and eggs. */
    val measurable: StateFlow<List<StopItemResponse>> = _measurable.asStateFlow()

    fun load(stopId: String) {
        viewModelScope.launch {
            val stop = tripRepository.getStop(stopId) ?: return@launch
            _measurable.value = tripRepository.itemsOf(stop).filter { it.orderLineId != null && (it.kind == "live_bird" || it.kind == "egg") }
        }
    }

    fun capturePodPhoto(tripId: String, stopId: String, localPath: String, mimeType: String) {
        viewModelScope.launch { tripRepository.queuePhoto(tripId, stopId, "pod", localPath, mimeType) }
    }

    fun captureWeighmentPhoto(tripId: String, stopId: String, localPath: String, mimeType: String) {
        viewModelScope.launch { tripRepository.queuePhoto(tripId, stopId, "weighment", localPath, mimeType) }
    }

    fun completeDelivery(
        tripId: String,
        stopId: String,
        recipientName: String,
        signatureData: String?,
        lines: List<DeliveryLineMeasure>,
        onDone: () -> Unit,
    ) {
        viewModelScope.launch {
            tripRepository.queueCompleteDeliveryStop(tripId, stopId, recipientName, signatureData, lines)
            onDone()
        }
    }
}
