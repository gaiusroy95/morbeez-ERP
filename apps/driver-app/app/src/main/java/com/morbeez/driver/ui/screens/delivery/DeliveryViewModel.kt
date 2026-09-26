package com.morbeez.driver.ui.screens.delivery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

/**
 * Delivery confirmation: proof of delivery — triggers Delivery Completed
 * on sync (Event Catalog). recipientName is always required; either a
 * signature or a 'pod'-type photo already captured on this stop satisfies
 * proof (the backend enforces this same rule — Driver App Architecture,
 * DRV.6 — this screen just can't submit without one locally either, so a
 * driver isn't told "success" only to have the sync pass reject it later).
 */
@HiltViewModel
class DeliveryViewModel @Inject constructor(
    private val tripRepository: TripRepository,
) : ViewModel() {

    fun capturePodPhoto(tripId: String, stopId: String, localPath: String, mimeType: String) {
        viewModelScope.launch { tripRepository.queuePhoto(tripId, stopId, "pod", localPath, mimeType) }
    }

    fun completeDelivery(
        tripId: String,
        stopId: String,
        recipientName: String,
        signatureData: String?,
        onDone: () -> Unit,
    ) {
        viewModelScope.launch {
            tripRepository.queueCompleteDeliveryStop(tripId, stopId, recipientName, signatureData)
            onDone()
        }
    }
}
