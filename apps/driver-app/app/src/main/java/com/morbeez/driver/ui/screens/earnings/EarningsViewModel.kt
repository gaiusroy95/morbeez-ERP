package com.morbeez.driver.ui.screens.earnings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.device.NetworkMonitor
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.remote.dto.DriverSettlementResponse
import com.morbeez.driver.data.remote.dto.MyEarningsResponse
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** My Earnings and Settlements, as the server last worked them out (kept on the phone), and what this phone has said since. */
data class EarningsUiState(
    val day: DriverDayEntity? = null,
    val today: MyEarningsResponse? = null,
    val week: MyEarningsResponse? = null,
    val month: MyEarningsResponse? = null,
    val settlements: List<DriverSettlementResponse>? = null,
    /** Settlements this phone said were received, not sent yet. */
    val sending: Set<String> = emptySet(),
    val online: Boolean = true,
) {
    fun of(period: String) = when (period) {
        "today" -> today
        "month" -> month
        else -> week
    }
}

@HiltViewModel
class EarningsViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
    network: NetworkMonitor,
) : ViewModel() {
    val state: StateFlow<EarningsUiState> = combine(trips.observeDay(), trips.observeQueuedAcknowledgements(), network.online) { day, sending, online ->
        EarningsUiState(day, trips.earningsOf(day, "today"), trips.earningsOf(day, "week"), trips.earningsOf(day, "month"), trips.settlementsOf(day), sending, online)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), EarningsUiState())

    fun refresh() = SyncWorker.requestNow(appContext)

    /** "I received it": on the phone at once, sent when there's signal. */
    fun received(settlementId: String) {
        viewModelScope.launch {
            trips.queueAcknowledgePay(settlementId)
            SyncWorker.requestNow(appContext)
        }
    }
}
