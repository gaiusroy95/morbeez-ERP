package com.morbeez.driver.ui.screens.expenses

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.remote.dto.TripExpenseResponse
import com.morbeez.driver.data.repository.TripRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Trip Summary — the driver's own recorded expenses and the trip's
 * advance; reconciliation itself stays a dispatcher action behind
 * logistics:reconcile (Driver App Architecture, DRV.17), so this screen
 * is read-only for that part.
 */
@HiltViewModel
class ExpensesViewModel @Inject constructor(
    private val tripRepository: TripRepository,
) : ViewModel() {

    private val _expenses = MutableStateFlow<List<TripExpenseResponse>>(emptyList())
    val expenses: StateFlow<List<TripExpenseResponse>> = _expenses.asStateFlow()

    fun load(tripId: String) {
        viewModelScope.launch { _expenses.value = tripRepository.listExpenses(tripId) }
    }

    fun recordExpense(tripId: String, category: String, amount: Double, notes: String?) {
        viewModelScope.launch { tripRepository.queueExpense(tripId, category, amount, notes) }
    }
}
