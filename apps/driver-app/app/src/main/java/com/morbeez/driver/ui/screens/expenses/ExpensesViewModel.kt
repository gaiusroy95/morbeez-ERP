package com.morbeez.driver.ui.screens.expenses

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.HandoverResponse
import com.morbeez.driver.data.remote.dto.TripExpenseResponse
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Trip summary and handover: what the trip spent, cash paid into the bank
 * on the road, what the driver should hand over, and submitting the trip
 * for the owner's reconciliation. Closing it stays the owner's action
 * (logistics:reconcile, DRV.17): the driver submits, the owner closes.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@HiltViewModel
class ExpensesViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val tripRepository: TripRepository,
) : ViewModel() {

    private val _expenses = MutableStateFlow<List<TripExpenseResponse>>(emptyList())
    val expenses: StateFlow<List<TripExpenseResponse>> = _expenses.asStateFlow()

    private val _handover = MutableStateFlow<HandoverResponse?>(null)
    /** Worked out by the server; null while offline. */
    val handover: StateFlow<HandoverResponse?> = _handover.asStateFlow()

    val trip: StateFlow<TripEntity?> = tripRepository.observeActiveTrip()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val tripId = MutableStateFlow<String?>(null)
    val stops: StateFlow<List<TripStopEntity>> = tripId
        .flatMapLatest { id -> if (id == null) emptyFlow() else tripRepository.observeStops(id) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        // An expense or deposit is queued, then synced; once the queue has
        // drained the server's figures include it, so read them again.
        viewModelScope.launch {
            tripRepository.observePendingCount()
                .map { it == 0 }
                .distinctUntilChanged()
                .drop(1)
                .filter { it }
                .collect { tripId.value?.let { refresh(it) } }
        }
    }

    fun load(id: String) {
        tripId.value = id
        viewModelScope.launch { refresh(id) }
    }

    private suspend fun refresh(id: String) {
        _expenses.value = tripRepository.listExpenses(id)
        _handover.value = tripRepository.getHandover(id)
    }

    fun recordExpense(tripId: String, category: String, amount: Double, notes: String?) {
        viewModelScope.launch {
            tripRepository.queueExpense(tripId, category, amount, notes)
            SyncWorker.requestNow(appContext)
        }
    }

    fun recordDeposit(tripId: String, amount: Double, bankAccount: String, reference: String) {
        viewModelScope.launch {
            tripRepository.queueDeposit(tripId, amount, bankAccount, reference)
            SyncWorker.requestNow(appContext)
        }
    }

    fun submit(tripId: String, cashDeclared: Double, note: String?) {
        viewModelScope.launch {
            tripRepository.queueSubmitTrip(tripId, cashDeclared, note)
            SyncWorker.requestNow(appContext)
        }
    }
}
