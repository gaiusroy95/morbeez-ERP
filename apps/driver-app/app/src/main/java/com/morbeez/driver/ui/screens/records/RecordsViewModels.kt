package com.morbeez.driver.ui.screens.records

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.device.NetworkMonitor
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.remote.dto.DriverApprovalsResponse
import com.morbeez.driver.data.remote.dto.DriverProfileResponse
import com.morbeez.driver.data.remote.dto.DriverTripSummaryResponse
import com.morbeez.driver.data.remote.dto.DriverVehicleResponse
import com.morbeez.driver.data.remote.dto.TripHistoryResponse
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import com.morbeez.driver.ui.screens.requests.UnsentRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.LocalDate
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Approvals, the vehicle and the profile, as the server last told them (kept on the phone). */
data class RecordsUiState(
    val day: DriverDayEntity? = null,
    val approvals: DriverApprovalsResponse? = null,
    val vehicle: DriverVehicleResponse? = null,
    val profile: DriverProfileResponse? = null,
    val online: Boolean = true,
    /** Asked on this phone, not with the office yet (D10). */
    val unsentRequests: List<UnsentRequest> = emptyList(),
) {
    /** When the server last answered, epoch millis. */
    val refreshedAt: Long? get() = day?.refreshedAt
}

@HiltViewModel
class RecordsViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    trips: TripRepository,
    network: NetworkMonitor,
) : ViewModel() {
    val state: StateFlow<RecordsUiState> = combine(trips.observeDay(), network.online, trips.observeUnsentRequests()) { day, online, unsent ->
        RecordsUiState(day, trips.approvalsOf(day), trips.vehicleOf(day), trips.profileOf(day), online, unsent)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RecordsUiState())

    /** Read again from the server (the queue goes first). */
    fun refresh() = SyncWorker.requestNow(appContext)
}

/** Past trips: read from the server when asked — they're not kept on the phone. */
data class HistoryUiState(
    val range: HistoryRange = HistoryRange.LAST_30_DAYS,
    val loading: Boolean = true,
    /** Null until read, or when there was no signal. */
    val history: TripHistoryResponse? = null,
)

@HiltViewModel
class TripHistoryViewModel @Inject constructor(private val trips: TripRepository) : ViewModel() {
    private val _state = MutableStateFlow(HistoryUiState())
    val state: StateFlow<HistoryUiState> = _state.asStateFlow()

    init {
        load(HistoryRange.LAST_30_DAYS)
    }

    fun load(range: HistoryRange) {
        _state.value = _state.value.copy(range = range, loading = true)
        viewModelScope.launch {
            val today = trips.getDay()?.today?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
            val dates = RecordsLogic.rangeOf(range, today)
            val history = trips.fetchHistory(dates?.first, dates?.second)
            _state.value = _state.value.copy(loading = false, history = history)
        }
    }
}

/** One trip in full: read from the server when opened. */
data class TripDetailsUiState(val loading: Boolean = true, val summary: DriverTripSummaryResponse? = null)

@HiltViewModel
class TripDetailsViewModel @Inject constructor(savedState: SavedStateHandle, private val trips: TripRepository) : ViewModel() {
    private val tripId: String = checkNotNull(savedState["tripId"])
    private val _state = MutableStateFlow(TripDetailsUiState())
    val state: StateFlow<TripDetailsUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true)
        viewModelScope.launch { _state.value = TripDetailsUiState(loading = false, summary = trips.fetchTripSummary(tripId)) }
    }
}
