package com.morbeez.driver.ui.screens.expenses

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val CATEGORIES = listOf("fuel", "toll", "labour", "other")

@Composable
fun ExpensesScreen(tripId: String, viewModel: ExpensesViewModel = hiltViewModel()) {
    LaunchedEffect(tripId) { viewModel.load(tripId) }
    val expenses by viewModel.expenses.collectAsStateWithLifecycle()

    var category by remember { mutableStateOf(CATEGORIES.first()) }
    var amountText by remember { mutableStateOf("") }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Trip expenses", style = MaterialTheme.typography.headlineSmall)

        LazyColumn(modifier = Modifier.fillMaxSize().weight(1f, fill = false)) {
            items(expenses, key = { it.id }) { expense ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                    Text(expense.category, modifier = Modifier.weight(1f))
                    Text("₹${expense.amount}")
                }
            }
        }

        Text("Record a new expense", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))

        Row(modifier = Modifier.padding(top = 8.dp)) {
            CATEGORIES.forEach { candidate ->
                FilterChip(
                    selected = category == candidate,
                    onClick = { category = candidate },
                    label = { Text(candidate) },
                    modifier = Modifier.padding(end = 8.dp),
                )
            }
        }

        OutlinedTextField(
            value = amountText,
            onValueChange = { amountText = it },
            label = { Text("Amount (₹)") },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )

        Button(
            onClick = {
                val amount = amountText.toDoubleOrNull()
                if (amount != null && amount > 0) {
                    viewModel.recordExpense(tripId, category, amount, null)
                    amountText = ""
                }
            },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Text("Add expense")
        }
    }
}
