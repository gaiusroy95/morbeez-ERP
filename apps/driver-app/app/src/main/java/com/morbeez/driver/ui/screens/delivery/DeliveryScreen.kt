package com.morbeez.driver.ui.screens.delivery

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
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
import com.morbeez.driver.ui.components.PhotoCaptureButton
import com.morbeez.driver.ui.components.SignaturePad

@Composable
fun DeliveryScreen(
    tripId: String,
    stopId: String,
    onDone: () -> Unit,
    viewModel: DeliveryViewModel = hiltViewModel(),
) {
    var recipientName by remember { mutableStateOf("") }
    var signature by remember { mutableStateOf<String?>(null) }
    var podPhotoCaptured by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Proof of delivery", style = MaterialTheme.typography.headlineSmall)

        OutlinedTextField(
            value = recipientName,
            onValueChange = { recipientName = it },
            label = { Text("Recipient name") },
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        )

        Text(
            "Capture a signature or a photo of the delivered goods — either one is proof.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 16.dp),
        )

        SignaturePad(onSigned = { signature = it }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))

        PhotoCaptureButton(
            label = if (podPhotoCaptured) "Photo captured ✓" else "Or photograph delivered goods",
            onCaptured = { path, mimeType ->
                viewModel.capturePodPhoto(tripId, stopId, path, mimeType)
                podPhotoCaptured = true
            },
            modifier = Modifier.padding(top = 8.dp),
        )

        Button(
            onClick = { viewModel.completeDelivery(tripId, stopId, recipientName.trim(), signature, onDone) },
            enabled = recipientName.isNotBlank() && (signature != null || podPhotoCaptured),
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        ) {
            Text("Confirm delivery")
        }
    }
}
