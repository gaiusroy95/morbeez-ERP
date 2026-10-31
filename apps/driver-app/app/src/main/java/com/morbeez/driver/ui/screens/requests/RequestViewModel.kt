package com.morbeez.driver.ui.screens.requests

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.device.LocationReader
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RequestUiState(
    /** Whose credit limit may be asked about: the trip's delivery customers. */
    val customers: List<TripCustomer> = emptyList(),
    /** Reading the phone's position for a new customer's pin. */
    val pinning: Boolean = false,
    /** The last try found no position (no permission, location off, no fix). */
    val pinFailed: Boolean = false,
)

@HiltViewModel
class RequestViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
    private val location: LocationReader,
) : ViewModel() {
    private val _state = MutableStateFlow(RequestUiState())
    val state: StateFlow<RequestUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch { _state.update { it.copy(customers = trips.tripCustomers()) } }
    }

    /** Where the phone is now: the new customer's map pin. */
    fun pinHere(onPinned: (Double, Double) -> Unit) {
        _state.update { it.copy(pinning = true, pinFailed = false) }
        viewModelScope.launch {
            val position = location.current()
            _state.update { it.copy(pinning = false, pinFailed = position == null) }
            position?.let { onPinned(it.latitude, it.longitude) }
        }
    }

    fun send(form: RequestForm, onDone: () -> Unit) {
        viewModelScope.launch {
            trips.queueRequest(form)
            SyncWorker.requestNow(appContext)
            onDone()
        }
    }
}
