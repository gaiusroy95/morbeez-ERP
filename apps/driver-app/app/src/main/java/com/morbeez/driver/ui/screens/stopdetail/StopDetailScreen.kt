package com.morbeez.driver.ui.screens.stopdetail

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.ui.components.PhotoCaptureButton

/**
 * A pickup stop completes right here (nothing more to capture than
 * confirmation); a delivery stop hands off to DeliveryScreen for POD and
 * on to CashCollectionScreen for payment (Driver App Architecture,
 * DRV.19). Photos can be attached from either kind of stop at any time.
 */
@Composable
fun StopDetailScreen(
    tripId: String,
    stopId: String,
    onOpenDelivery: (stopId: String) -> Unit,
    onOpenCollection: (stopId: String) -> Unit,
    onOpenIssueReport: (stopId: String) -> Unit,
    onBack: () -> Unit,
    viewModel: StopDetailViewModel = hiltViewModel(),
) {
    LaunchedEffect(stopId) { viewModel.load(stopId) }
    val stop by viewModel.stop.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        val current = stop ?: return@Column

        Text(current.counterpartyName, style = MaterialTheme.typography.headlineSmall)
        Text(current.summary, style = MaterialTheme.typography.bodyMedium)
        if (!current.notes.isNullOrBlank()) {
            Text("Notes: ${current.notes}", style = MaterialTheme.typography.bodySmall)
        }

        PhotoCaptureButton(
            label = if (current.stopType == "pickup") "Photograph produce" else "Photograph delivery",
            onCaptured = { path, mimeType ->
                val photoType = if (current.stopType == "pickup") "pickup" else "delivery"
                viewModel.capturePhoto(tripId, stopId, photoType, path, mimeType)
            },
            modifier = Modifier.padding(top = 16.dp),
        )

        if (current.status == "pending") {
            if (current.stopType == "pickup") {
                Button(
                    onClick = { viewModel.completePickup(tripId, stopId, onBack) },
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                ) {
                    Text("Complete pickup")
                }
            } else {
                Button(
                    onClick = { onOpenDelivery(stopId) },
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                ) {
                    Text("Complete delivery")
                }
                OutlinedButton(
                    onClick = { onOpenCollection(stopId) },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                ) {
                    Text("Record cash / payment collected")
                }
            }

            OutlinedButton(
                onClick = { onOpenIssueReport(stopId) },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) {
                Text("Skip / report an issue")
            }
        } else {
            Text(
                "This stop is already ${current.status}.",
                modifier = Modifier.padding(top = 16.dp),
            )
        }
    }
}
