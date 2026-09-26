package com.morbeez.driver.ui.screens.shortage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

/**
 * Reports why a stop couldn't be completed as planned — a shortage, a
 * spoiled delivery, a farmer not ready — and skips it (Event Catalog,
 * Delivery Shortage Reported). The photo is evidence, queued the same way
 * a pickup/delivery photo is; skipping the stop itself is a normal
 * PendingOperation.
 */
@HiltViewModel
class ShortageReportViewModel @Inject constructor(
    private val tripRepository: TripRepository,
) : ViewModel() {

    fun captureIssuePhoto(tripId: String, stopId: String, localPath: String, mimeType: String) {
        viewModelScope.launch { tripRepository.queuePhoto(tripId, stopId, "issue", localPath, mimeType) }
    }

    fun reportAndSkip(tripId: String, stopId: String, onDone: () -> Unit) {
        viewModelScope.launch {
            tripRepository.queueSkipStop(tripId, stopId)
            onDone()
        }
    }
}
