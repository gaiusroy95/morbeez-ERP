package com.morbeez.driver.ui.screens.stopdetail

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.PhotoCaptureButton
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.theme.Fresh

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
    var photoTaken by remember { mutableStateOf(false) }

    val current = stop
    val isPickup = current?.stopType == "pickup"
    val pending = current?.status == "pending"

    FieldScreen(
        title = current?.counterpartyName ?: "Stop",
        eyebrow = current?.let { "Stop ${it.sequenceNumber} · ${if (isPickup) "Pickup" else "Delivery"}" },
        onBack = onBack,
        headerExtra = {
            if (current != null) {
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    when (current.status) {
                        "completed" -> Pill("Completed", Tone.Good)
                        "skipped" -> Pill("Skipped", Tone.Attention)
                        else -> Pill("To do", Tone.Lime)
                    }
                    if (current.pendingSync) {
                        Spacer(Modifier.width(8.dp))
                        Pill("Saving…", Tone.Neutral, onDark = true)
                    }
                }
            }
        },
        bottomBar = if (current != null && pending) {
            {
                if (isPickup) {
                    PrimaryAction("Complete pickup", onClick = { viewModel.completePickup(tripId, stopId, onBack) }, glyph = Glyph.Check)
                } else {
                    PrimaryAction("Confirm delivery", onClick = { onOpenDelivery(stopId) }, glyph = Glyph.Arrow)
                }
            }
        } else {
            null
        },
    ) {
        if (current == null) return@FieldScreen

        FieldCard {
            Eyebrow(if (isPickup) "What to collect" else "What to deliver")
            Text(
                current.summary,
                style = MaterialTheme.typography.titleMedium,
                color = Fresh.ink,
                modifier = Modifier.padding(top = 8.dp),
            )
            if (!current.notes.isNullOrBlank()) {
                Spacer(Modifier.padding(top = 12.dp))
                Callout(current.notes, tone = Tone.Active, glyph = Glyph.Pin)
            }
        }

        PhotoCaptureButton(
            label = when {
                photoTaken -> "Photo attached"
                isPickup -> "Photograph the produce"
                else -> "Photograph the delivery"
            },
            captured = photoTaken,
            onCaptured = { path, mimeType ->
                viewModel.capturePhoto(tripId, stopId, if (isPickup) "pickup" else "delivery", path, mimeType)
                photoTaken = true
            },
        )

        if (pending) {
            if (!isPickup) {
                SecondaryAction("Record cash or payment", onClick = { onOpenCollection(stopId) }, glyph = Glyph.Rupee)
            }
            SecondaryAction("Skip or report a problem", onClick = { onOpenIssueReport(stopId) }, glyph = Glyph.Warning)
        } else {
            Callout(
                if (current.status == "completed") "This stop is done." else "This stop was skipped.",
                tone = if (current.status == "completed") Tone.Good else Tone.Attention,
                glyph = if (current.status == "completed") Glyph.Check else Glyph.Warning,
            )
        }
    }
}
