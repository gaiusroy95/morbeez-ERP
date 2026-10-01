package com.morbeez.driver.ui.screens.delivery

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.padding
import androidx.hilt.navigation.compose.hiltViewModel
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.PhotoCaptureButton
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SignaturePad
import com.morbeez.driver.ui.components.StepTitle
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.theme.Fresh

/** Proof of delivery: who received it, then a signature or a photo — either is proof. */
@Composable
fun DeliveryScreen(
    tripId: String,
    stopId: String,
    onDone: () -> Unit,
    onBack: (() -> Unit)? = null,
    viewModel: DeliveryViewModel = hiltViewModel(),
) {
    var recipientName by remember { mutableStateOf("") }
    var signature by remember { mutableStateOf<String?>(null) }
    var podPhotoCaptured by remember { mutableStateOf(false) }
    val hasProof = signature != null || podPhotoCaptured

    FieldScreen(
        title = "Proof of delivery",
        eyebrow = "Delivery",
        onBack = onBack,
        bottomBar = {
            PrimaryAction(
                text = "Confirm delivery",
                onClick = { viewModel.completeDelivery(tripId, stopId, recipientName.trim(), signature, onDone) },
                enabled = recipientName.isNotBlank() && hasProof,
                glyph = Glyph.Check,
            )
        },
    ) {
        FieldCard {
            StepTitle(1, "Who received it")
            FreshTextField(value = recipientName, onValueChange = { recipientName = it }, label = "Recipient name", leading = Glyph.User)
        }

        FieldCard {
            StepTitle(2, "Proof: a signature or a photo")
            if (signature != null) {
                Callout("Signature saved.", tone = Tone.Good, glyph = Glyph.Check)
            } else {
                SignaturePad(onSigned = { signature = it })
            }
            Text(
                "or",
                style = MaterialTheme.typography.labelMedium,
                color = Fresh.inkFaint,
                modifier = Modifier.padding(vertical = 10.dp),
            )
            PhotoCaptureButton(
                label = if (podPhotoCaptured) "Photo of the goods attached" else "Photograph the delivered goods",
                captured = podPhotoCaptured,
                onCaptured = { path, mimeType ->
                    viewModel.capturePodPhoto(tripId, stopId, path, mimeType)
                    podPhotoCaptured = true
                },
            )
        }
    }
}
