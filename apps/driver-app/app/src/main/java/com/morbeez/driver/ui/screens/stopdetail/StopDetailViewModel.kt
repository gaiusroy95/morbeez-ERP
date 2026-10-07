package com.morbeez.driver.ui.screens.stopdetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.FarmWeight
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class StopDetailViewModel @Inject constructor(
    private val tripRepository: TripRepository,
) : ViewModel() {

    private val _stop = MutableStateFlow<TripStopEntity?>(null)
    val stop: StateFlow<TripStopEntity?> = _stop.asStateFlow()

    /** The driver's delegation level on the trip (null: not known yet — the server decides either way). */
    val authorityLevel: StateFlow<Int?> = tripRepository.observeActiveTrip()
        .map { it?.authorityLevel }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _items = MutableStateFlow<List<StopItemResponse>>(emptyList())
    /** The stop's lines: for a pickup, what's weighed at the farm. */
    val items: StateFlow<List<StopItemResponse>> = _items.asStateFlow()

    fun load(stopId: String) {
        viewModelScope.launch {
            val stop = tripRepository.getStop(stopId)
            _stop.value = stop
            _items.value = stop?.let { tripRepository.itemsOf(it) } ?: emptyList()
        }
    }

    /** Photos are queued for upload immediately — they don't wait for the driver to also complete the stop. */
    fun capturePhoto(tripId: String, stopId: String, photoType: String, localPath: String, mimeType: String) {
        viewModelScope.launch { tripRepository.queuePhoto(tripId, stopId, photoType, localPath, mimeType) }
    }

    /** [weights]: the farm weighment, net per product — the purchase weight the farmer is settled on. */
    fun completePickup(tripId: String, stopId: String, weights: List<FarmWeight>, onDone: () -> Unit) {
        viewModelScope.launch {
            tripRepository.queueCompletePickupStop(tripId, stopId, weights)
            onDone()
        }
    }
}
