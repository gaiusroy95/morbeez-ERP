package com.morbeez.driver.ui.screens.expenses

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.ExpenseEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.remote.dto.MyExpensesResponse
import com.morbeez.driver.data.repository.NewExpense
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** My Expenses and New Expense, from Room: the trip's expenses on this phone, and the server's last list of the rest. */
data class ExpensesUiState(
    val trip: TripEntity? = null,
    val day: DriverDayEntity? = null,
    /** This trip's, newest first. */
    val expenses: List<ExpenseEntity> = emptyList(),
    /** The last 30 days', as the server last listed them, with the vehicle's mileage. */
    val recent: MyExpensesResponse? = null,
    /** The vehicle's fuel, to default New Expense's fuel type. */
    val vehicleFuelType: String? = null,
) {
    val thisTrip: List<ExpenseRow> get() = expenses.sortedByDescending { it.recordedAt }.map { ExpenseLogic.rowOf(it, trip?.number) }
    val allTrips: List<ExpenseRow> get() = ExpenseLogic.allTrips(recent, thisTrip)
    /** Expenses are recorded on a trip that's on the road (or planned), not after it's handed over. */
    val canRecord: Boolean get() = trip?.status == "in_progress" || trip?.status == "planned"
}

@OptIn(ExperimentalCoroutinesApi::class)
fun expensesOf(trips: TripRepository): Flow<ExpensesUiState> {
    val tripExpenses = trips.observeActiveTrip().flatMapLatest { trip ->
        if (trip == null) flowOf(null to emptyList()) else trips.observeExpenses(trip.id).map { trip to it }
    }
    return combine(trips.observeDay(), tripExpenses) { day, (trip, expenses) ->
        ExpensesUiState(trip, day, expenses, trips.myExpensesOf(day), trips.vehicleOf(day)?.fuelType)
    }
}

@HiltViewModel
class ExpensesViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
) : ViewModel() {
    val state: StateFlow<ExpensesUiState> = expensesOf(trips).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ExpensesUiState())

    /** Read again from the server (the queue goes first). */
    fun refresh() = SyncWorker.requestNow(appContext)

    /** On the phone at once; the bill follows the expense when there's signal. */
    fun save(expense: NewExpense, bill: Pair<String, String>?, onDone: () -> Unit) {
        val trip = state.value.trip ?: return
        viewModelScope.launch {
            val id = trips.queueExpense(trip.id, expense)
            bill?.let { (path, mime) -> trips.queueExpensePhoto(trip.id, id, path, mime) }
            SyncWorker.requestNow(appContext)
            onDone()
        }
    }

    /** Cash paid into the bank on the road: it no longer has to be handed over. */
    fun recordDeposit(amount: Double, bankAccount: String, reference: String) {
        val trip = state.value.trip ?: return
        viewModelScope.launch {
            trips.queueDeposit(trip.id, amount, bankAccount, reference)
            SyncWorker.requestNow(appContext)
        }
    }
}
