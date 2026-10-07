package com.morbeez.driver.ui.screens.stopdetail

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
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
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.data.remote.dto.FarmWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.runtime.mutableStateMapOf
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
    val items by viewModel.items.collectAsStateWithLifecycle()
    // Pickup: the net weight per product as weighed at the farm (no tare sums here).
    val farmWeights = remember { mutableStateMapOf<String, String>() }
    fun weights() = items.mapNotNull { i ->
        farmWeights[i.productId]?.replace(",", "")?.toDoubleOrNull()?.takeIf { it > 0 }?.let { FarmWeight(i.productId, it) }
    }
    val level by viewModel.authorityLevel.collectAsStateWithLifecycle()
    // Unknown (null) lets the driver try: the server is the judge either way.
    val canAct = level != 0
    val canCollect = level == null || level!! >= 2
    val canBuy = level == null || level!! >= 3
    var photoTaken by remember { mutableStateOf(false) }

    val current = stop
    val isPickup = current?.stopType == "pickup"
    val pending = current?.status == "pending"

    FieldScreen(
        title = current?.counterpartyName ?: stringResource(R.string.stop),
        eyebrow = current?.let { stringResource(R.string.stop_eyebrow, it.sequenceNumber, stringResource(if (isPickup) R.string.kind_pickup else R.string.kind_delivery)) },
        onBack = onBack,
        headerExtra = {
            if (current != null) {
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    when (current.status) {
                        "completed" -> Pill(stringResource(R.string.pill_completed), Tone.Good)
                        "skipped" -> Pill(stringResource(R.string.pill_skipped), Tone.Attention)
                        else -> Pill(stringResource(R.string.pill_to_do), Tone.Lime)
                    }
                    if (current.pendingSync) {
                        Spacer(Modifier.width(8.dp))
                        Pill(stringResource(R.string.saving), Tone.Neutral, onDark = true)
                    }
                }
            }
        },
        bottomBar = if (current != null && pending) {
            {
                if (isPickup) {
                    PrimaryAction(stringResource(R.string.complete_pickup), onClick = { viewModel.completePickup(tripId, stopId, weights(), onBack) }, glyph = Glyph.Check, enabled = canBuy)
                } else {
                    PrimaryAction(stringResource(R.string.confirm_delivery), onClick = { onOpenDelivery(stopId) }, glyph = Glyph.Arrow, enabled = canAct)
                }
            }
        } else {
            null
        },
    ) {
        if (current == null) return@FieldScreen

        FieldCard {
            Eyebrow(stringResource(if (isPickup) R.string.what_to_collect else R.string.what_to_deliver))
            Text(
                current.summary,
                style = MaterialTheme.typography.titleMedium,
                color = Fresh.ink,
                modifier = Modifier.padding(top = 8.dp),
            )
            if (!isPickup && current.collectTerms != null) {
                Text(
                    if (current.collectTerms == "cash") stringResource(R.string.collect_amount, current.collectAmount.orEmpty()) else stringResource(R.string.on_credit),
                    style = MaterialTheme.typography.titleMedium,
                    color = Fresh.primary,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            if (!current.notes.isNullOrBlank()) {
                Spacer(Modifier.padding(top = 12.dp))
                Callout(current.notes, tone = Tone.Active, glyph = Glyph.Pin)
            }
        }

        if (pending) {
            when {
                !canAct -> Callout(stringResource(R.string.not_approved_yet), tone = Tone.Attention)
                isPickup && !canBuy -> Callout(stringResource(R.string.needs_level_3), tone = Tone.Attention)
                !isPickup && !canCollect -> Callout(stringResource(R.string.needs_level_2), tone = Tone.Active)
            }
        }

        if (isPickup && pending && items.isNotEmpty()) {
            FieldCard {
                Eyebrow(stringResource(R.string.weighed_at_farm))
                Text(
                    stringResource(R.string.weighed_at_farm_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = Fresh.inkMuted,
                    modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
                )
                items.forEach { item ->
                    FreshTextField(
                        value = farmWeights[item.productId].orEmpty(),
                        onValueChange = { farmWeights[item.productId] = it },
                        label = stringResource(R.string.farm_weight_label, item.productName, if (item.kind == "egg") stringResource(R.string.eggs) else item.uom),
                        keyboardType = KeyboardType.Decimal,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }

        PhotoCaptureButton(
            label = when {
                photoTaken -> stringResource(R.string.photo_attached)
                isPickup -> stringResource(R.string.photo_produce)
                else -> stringResource(R.string.photo_delivery)
            },
            captured = photoTaken,
            onCaptured = { path, mimeType ->
                viewModel.capturePhoto(tripId, stopId, if (isPickup) "pickup" else "delivery", path, mimeType)
                photoTaken = true
            },
        )

        if (pending) {
            if (!isPickup) {
                SecondaryAction(stringResource(R.string.record_payment), onClick = { onOpenCollection(stopId) }, glyph = Glyph.Rupee, enabled = canCollect)
            }
            SecondaryAction(stringResource(R.string.skip_or_report), onClick = { onOpenIssueReport(stopId) }, glyph = Glyph.Warning)
        } else {
            Callout(
                stringResource(if (current.status == "completed") R.string.stop_done else R.string.stop_skipped),
                tone = if (current.status == "completed") Tone.Good else Tone.Attention,
                glyph = if (current.status == "completed") Glyph.Check else Glyph.Warning,
            )
        }
    }
}
