package com.morbeez.driver.ui.screens.route

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.data.local.TripStopEntity

/**
 * Today's Trip + the Route — the driver's home screen (Driver App
 * Architecture, DRV.19). An empty active trip shows a clear "nothing
 * assigned yet" state rather than an empty list that looks broken
 * (System Architecture, MOB.4).
 */
@Composable
fun RouteScreen(
    onOpenStop: (tripId: String, stopId: String) -> Unit,
    onOpenExpenses: (tripId: String) -> Unit,
    viewModel: RouteViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Today's Trip", style = MaterialTheme.typography.headlineSmall)
            Button(onClick = viewModel::requestSync, enabled = !state.isSyncing) {
                Text(if (state.isSyncing) "Syncing…" else "Sync")
            }
        }

        val trip = state.trip
        if (trip == null) {
            Text(
                "No trip assigned yet. Pull to sync once dispatch has planned your route.",
                modifier = Modifier.padding(top = 24.dp),
            )
            return@Column
        }

        Text(
            "Status: ${trip.status}  ·  Advance: ₹${trip.advanceAmount}",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
        )

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(state.stops, key = { it.id }) { stop ->
                StopRow(stop = stop, onClick = { onOpenStop(trip.id, stop.id) })
            }
        }

        Button(
            onClick = { onOpenExpenses(trip.id) },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        ) {
            Text("Trip expenses & summary")
        }
    }
}

@Composable
private fun StopRow(stop: TripStopEntity, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                "${stop.sequenceNumber}. ${stop.stopType.replaceFirstChar { it.uppercase() }} — ${stop.counterpartyName}",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(stop.summary, style = MaterialTheme.typography.bodySmall)
            val statusLabel = if (stop.pendingSync) "${stop.status} (syncing…)" else stop.status
            Text(statusLabel, style = MaterialTheme.typography.labelMedium)
        }
    }
}
