package com.morbeez.driver.ui.screens.cash

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

private val METHODS = listOf("cash", "upi", "bank_transfer", "cheque")

@Composable
fun CashCollectionScreen(
    tripId: String,
    stopId: String,
    onDone: () -> Unit,
    viewModel: CashCollectionViewModel = hiltViewModel(),
) {
    var amountText by remember { mutableStateOf("") }
    var method by remember { mutableStateOf(METHODS.first()) }
    var notes by remember { mutableStateOf("") }

    val amount = amountText.toDoubleOrNull()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Collect payment", style = MaterialTheme.typography.headlineSmall)

        OutlinedTextField(
            value = amountText,
            onValueChange = { amountText = it },
            label = { Text("Amount (₹)") },
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        )

        Row(modifier = Modifier.padding(top = 12.dp)) {
            METHODS.forEach { candidate ->
                FilterChip(
                    selected = method == candidate,
                    onClick = { method = candidate },
                    label = { Text(candidate.replace('_', ' ')) },
                    modifier = Modifier.padding(end = 8.dp),
                )
            }
        }

        OutlinedTextField(
            value = notes,
            onValueChange = { notes = it },
            label = { Text("Notes (optional)") },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )

        Button(
            onClick = {
                viewModel.recordCollection(tripId, stopId, amount ?: 0.0, method, notes.ifBlank { null }, onDone)
            },
            enabled = amount != null && amount > 0,
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        ) {
            Text("Record collection")
        }
    }
}
