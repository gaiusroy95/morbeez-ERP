package com.morbeez.driver.ui.screens.shortage

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.morbeez.driver.ui.components.PhotoCaptureButton

/**
 * Reports delivered/picked-up quantity short of what was planned, or any
 * other reason a stop can't be completed — attach evidence, then skip
 * (Event Catalog, Delivery Shortage Reported).
 */
@Composable
fun ShortageReportScreen(
    tripId: String,
    stopId: String,
    onDone: () -> Unit,
    viewModel: ShortageReportViewModel = hiltViewModel(),
) {
    var photoCaptured by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Report an issue", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Photograph the shortage, spoilage, or whatever's preventing this stop from being completed as planned.",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
        )

        PhotoCaptureButton(
            label = if (photoCaptured) "Photo attached ✓" else "Photograph the issue",
            onCaptured = { path, mimeType ->
                viewModel.captureIssuePhoto(tripId, stopId, path, mimeType)
                photoCaptured = true
            },
        )

        Button(
            onClick = { viewModel.reportAndSkip(tripId, stopId, onDone) },
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        ) {
            Text("Report and skip this stop")
        }
    }
}
