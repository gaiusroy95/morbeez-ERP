package com.morbeez.driver.ui.screens.cash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

/** Cash/payment collection at a stop — feeds Payment Received and the trip's own cash reconciliation (Accounting Engine, Logistics Trip Reconciliation). */
@HiltViewModel
class CashCollectionViewModel @Inject constructor(
    private val tripRepository: TripRepository,
) : ViewModel() {

    fun recordCollection(
        tripId: String,
        stopId: String,
        amount: Double,
        method: String,
        notes: String?,
        onDone: () -> Unit,
    ) {
        viewModelScope.launch {
            tripRepository.queueCollection(tripId, stopId, amount, method, notes)
            onDone()
        }
    }
}
