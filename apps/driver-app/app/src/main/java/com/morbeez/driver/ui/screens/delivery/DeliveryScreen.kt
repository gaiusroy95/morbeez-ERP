package com.morbeez.driver.ui.screens.delivery

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.data.remote.dto.DeliveryLineMeasure
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
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

private fun qty(s: String) = s.trimEnd('0').trimEnd('.')

/** Proof of delivery: who received it, then a signature or a photo — either is proof. */
@Composable
fun DeliveryScreen(
    tripId: String,
    stopId: String,
    onDone: () -> Unit,
    onBack: (() -> Unit)? = null,
    viewModel: DeliveryViewModel = hiltViewModel(),
) {
    LaunchedEffect(stopId) { viewModel.load(stopId) }
    val measurable by viewModel.measurable.collectAsStateWithLifecycle()
    var recipientName by remember { mutableStateOf("") }
    var signature by remember { mutableStateOf<String?>(null) }
    var podPhotoCaptured by remember { mutableStateOf(false) }
    var scalePhotoCaptured by remember { mutableStateOf(false) }
    // Per order line: what the driver typed (kg on the customer's scale, or eggs broken).
    val entries = remember { mutableStateMapOf<String, String>() }
    val hasProof = signature != null || podPhotoCaptured

    fun measures(): List<DeliveryLineMeasure> = measurable.mapNotNull { item ->
        val value = entries[item.orderLineId]?.replace(",", "")?.toDoubleOrNull() ?: return@mapNotNull null
        if (item.kind == "live_bird") DeliveryLineMeasure(item.orderLineId!!, customerWeight = value)
        else DeliveryLineMeasure(item.orderLineId!!, brokenQuantity = value)
    }
    val invalid = measurable.any { item ->
        val raw = entries[item.orderLineId].orEmpty()
        val v = raw.replace(",", "").toDoubleOrNull()
        raw.isNotBlank() && (v == null || v < 0 || (item.kind == "egg" && v > (item.quantity.toDoubleOrNull() ?: 0.0)))
    }

    FieldScreen(
        title = stringResource(R.string.pod_title),
        eyebrow = stringResource(R.string.kind_delivery),
        onBack = onBack,
        bottomBar = {
            PrimaryAction(
                text = stringResource(R.string.confirm_delivery),
                onClick = { viewModel.completeDelivery(tripId, stopId, recipientName.trim(), signature, measures(), onDone) },
                enabled = recipientName.isNotBlank() && hasProof && !invalid,
                glyph = Glyph.Check,
            )
        },
    ) {
        FieldCard {
            StepTitle(1, stringResource(R.string.who_received))
            FreshTextField(value = recipientName, onValueChange = { recipientName = it }, label = stringResource(R.string.recipient_name), leading = Glyph.User)
        }

        FieldCard {
            StepTitle(2, stringResource(R.string.proof_step))
            if (signature != null) {
                Callout(stringResource(R.string.signature_saved), tone = Tone.Good, glyph = Glyph.Check)
            } else {
                SignaturePad(onSigned = { signature = it })
            }
            Text(
                stringResource(R.string.or),
                style = MaterialTheme.typography.labelMedium,
                color = Fresh.inkFaint,
                modifier = Modifier.padding(vertical = 10.dp),
            )
            PhotoCaptureButton(
                label = stringResource(if (podPhotoCaptured) R.string.photo_goods_attached else R.string.photo_goods),
                captured = podPhotoCaptured,
                onCaptured = { path, mimeType ->
                    viewModel.capturePodPhoto(tripId, stopId, path, mimeType)
                    podPhotoCaptured = true
                },
            )
        }

        if (measurable.isNotEmpty()) {
            FieldCard {
                StepTitle(3, stringResource(R.string.at_customer))
                measurable.forEach { item -> MeasureRow(item, entries[item.orderLineId].orEmpty()) { entries[item.orderLineId!!] = it } }
                if (measurable.any { it.kind == "live_bird" }) {
                    Spacer(Modifier.height(10.dp))
                    PhotoCaptureButton(
                        label = stringResource(if (scalePhotoCaptured) R.string.photo_scale_attached else R.string.photo_scale),
                        captured = scalePhotoCaptured,
                        onCaptured = { path, mimeType ->
                            viewModel.captureWeighmentPhoto(tripId, stopId, path, mimeType)
                            scalePhotoCaptured = true
                        },
                    )
                }
            }
        }
    }
}

/**
 * One live-bird or egg line: the farm weight (or count) that left, and what
 * the customer end measured. Leave it blank when they didn't weigh — the
 * farm weight stands.
 */
@Composable
private fun MeasureRow(item: StopItemResponse, value: String, onChange: (String) -> Unit) {
    val dispatched = item.quantity.toDoubleOrNull() ?: 0.0
    val entered = value.replace(",", "").toDoubleOrNull()
    Spacer(Modifier.height(8.dp))
    Eyebrow(item.productName)
    if (item.kind == "live_bird") {
        Text(stringResource(R.string.farm_weight, qty(item.quantity)), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        FreshTextField(
            value = value,
            onValueChange = onChange,
            label = stringResource(R.string.customer_scale),
            keyboardType = KeyboardType.Decimal,
            modifier = Modifier.padding(top = 6.dp),
        )
        if (entered != null && dispatched > 0) {
            val loss = dispatched - entered
            val pct = loss / dispatched * 100
            Text(
                if (loss >= 0) stringResource(R.string.shrinkage_less, "%.1f".format(loss), "%.2f".format(pct))
                else stringResource(R.string.shrinkage_more, "%.1f".format(-loss)),
                style = MaterialTheme.typography.bodySmall,
                color = Fresh.inkMuted,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    } else {
        val trays = item.packSize?.takeIf { it > 0 }?.let { dispatched / it }
        Text(
            trays?.let { stringResource(R.string.egg_count_trays, qty(item.quantity), qty("%.2f".format(it))) } ?: stringResource(R.string.egg_count, qty(item.quantity)),
            style = MaterialTheme.typography.bodyMedium,
            color = Fresh.inkMuted,
        )
        FreshTextField(
            value = value,
            onValueChange = onChange,
            label = stringResource(R.string.broken_eggs),
            keyboardType = KeyboardType.Number,
            modifier = Modifier.padding(top = 6.dp),
        )
        if (entered != null && entered > dispatched) {
            Text(stringResource(R.string.more_than_loaded), style = MaterialTheme.typography.bodySmall, color = Fresh.critical)
        }
    }
}
