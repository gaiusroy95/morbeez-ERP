package com.morbeez.driver.ui.screens.stopdetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class StopDetailViewModel @Inject constructor(
    private val tripRepository: TripRepository,
) : ViewModel() {

    private val _stop = MutableStateFlow<TripStopEntity?>(null)
    val stop: StateFlow<TripStopEntity?> = _stop.asStateFlow()

    fun load(stopId: String) {
        viewModelScope.launch { _stop.value = tripRepository.getStop(stopId) }
    }

    /** Photos are queued for upload immediately — they don't wait for the driver to also complete the stop. */
    fun capturePhoto(tripId: String, stopId: String, photoType: String, localPath: String, mimeType: String) {
        viewModelScope.launch { tripRepository.queuePhoto(tripId, stopId, photoType, localPath, mimeType) }
    }

    fun completePickup(tripId: String, stopId: String, onDone: () -> Unit) {
        viewModelScope.launch {
            tripRepository.queueCompletePickupStop(tripId, stopId)
            onDone()
        }
    }
}
