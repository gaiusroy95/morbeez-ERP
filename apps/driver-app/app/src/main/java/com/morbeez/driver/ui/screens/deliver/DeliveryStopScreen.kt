package com.morbeez.driver.ui.screens.deliver

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.morbeez.driver.R
import com.morbeez.driver.data.local.CrateDraft
import com.morbeez.driver.data.local.DeliveryDraft
import com.morbeez.driver.data.local.DeliveryLineDraft
import com.morbeez.driver.data.local.QrState
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.ui.components.WithRefusal
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldIntents
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.HoldToConfirm
import com.morbeez.driver.ui.components.PhotoCaptureButton
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.TonalAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.theme.Fresh

/** A delivery's screens (design sheet 9 Next stop, 10 Scan customer QR, 11 Deliver items). */
enum class DeliveryStep { NEXT, QR, ITEMS }

private val cameraPhoto: PhotoSlot = { label, captured, onCaptured -> PhotoCaptureButton(label = label, onCaptured = onCaptured, captured = captured) }

/** Why a QR wasn't scanned, kept in English for the owner (the client's answer 5). */
private val QR_NOTES = listOf("QR missing" to R.string.qr_missing, "QR damaged" to R.string.qr_damaged, "QR won't scan" to R.string.qr_wont_scan, "Other" to R.string.reason_other)

@Composable
fun DeliveryStopScreen(
    onBack: () -> Unit,
    onDone: () -> Unit,
    onCollect: () -> Unit,
    onReport: () -> Unit,
    onOpenSync: () -> Unit = {},
    viewModel: DeliveryStopViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val refused by viewModel.refused.collectAsStateWithLifecycle()
    var chosen by rememberSaveable { mutableStateOf<DeliveryStep?>(null) }
    val step = chosen ?: initialStepOf(state)
    val prompt = stringResource(R.string.scan_prompt)
    val scan = rememberLauncherForActivityResult(ScanContract()) { result -> result.contents?.let(viewModel::scanned) }

    BackHandler(enabled = state.stop?.status == "pending" && step != DeliveryStep.NEXT) {
        chosen = if (step == DeliveryStep.ITEMS) DeliveryStep.QR else DeliveryStep.NEXT
    }

    WithRefusal(refused, onOpenSync) { DeliveryStopContent(
        state = state,
        step = step,
        onStep = { chosen = it },
        onBack = onBack,
        onStart = viewModel::startDeliveries,
        onArrive = {
            viewModel.arrive()
            chosen = DeliveryStep.QR
        },
        onScan = {
            scan.launch(
                ScanOptions()
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt(prompt)
                    .setBeepEnabled(true)
                    .setOrientationLocked(false),
            )
        },
        onNotScanned = viewModel::notScanned,
        onEdit = viewModel::edit,
        onPhoto = viewModel::deliveryPhoto,
        onScalePhoto = viewModel::scalePhoto,
        onComplete = { viewModel.complete(onDone) },
        onCollect = onCollect,
        onReport = onReport,
    ) }
}

/** Where a delivery picks up: on the way, at the door for the QR, or with the goods. */
private fun initialStepOf(state: DeliveryUiState): DeliveryStep = when {
    !state.arrived -> DeliveryStep.NEXT
    state.draft?.qr == QrState.NONE -> DeliveryStep.QR
    else -> DeliveryStep.ITEMS
}

/** The delivery from state alone (the screenshot tests draw it with a sample shop). */
@Composable
internal fun DeliveryStopContent(
    state: DeliveryUiState,
    step: DeliveryStep,
    onStep: (DeliveryStep) -> Unit,
    onBack: () -> Unit,
    onStart: () -> Unit,
    onArrive: () -> Unit,
    onScan: () -> Unit,
    onNotScanned: (String) -> Unit,
    onEdit: ((DeliveryDraft) -> DeliveryDraft) -> Unit,
    onPhoto: (String, String) -> Unit,
    onScalePhoto: (String, String) -> Unit,
    onComplete: () -> Unit,
    onCollect: () -> Unit,
    onReport: () -> Unit = {},
    photo: PhotoSlot = cameraPhoto,
) {
    val stop = state.stop ?: return
    if (stop.status != "pending") {
        CompletedDelivery(state, onBack, onCollect)
        return
    }
    val draft = state.draft ?: return
    when (step) {
        DeliveryStep.NEXT -> NextStop(state, onBack, onStart, onArrive, onQr = { onStep(DeliveryStep.QR) }, onReport)
        DeliveryStep.QR -> ScanQr(state, draft, onBack = { onStep(DeliveryStep.NEXT) }, onScan, onNotScanned, onContinue = { onStep(DeliveryStep.ITEMS) })
        DeliveryStep.ITEMS -> DeliverItems(state, draft, onBack = { onStep(DeliveryStep.QR) }, onEdit, onPhoto, onScalePhoto, onComplete, photo, onReport)
    }
}

/** "100 kg"; eggs in their own word. */
@Composable
private fun amount(quantity: String?, uom: String): String =
    stringResource(R.string.amount_unit, DayLogic.quantity(quantity), if (uom == "piece") stringResource(R.string.eggs) else uom)

private fun shortLabel(reason: String?): Int = when (reason) {
    "customer_took_less" -> R.string.short_customer_took_less
    "damaged" -> R.string.reason_damaged
    "not_enough_on_vehicle" -> R.string.short_not_enough
    "quality_issue" -> R.string.reason_quality_issue
    else -> R.string.reason_other
}

// ---------------------------------------------------------------------------
// Next stop (design sheet screen 9)
// ---------------------------------------------------------------------------

@Composable
private fun NextStop(state: DeliveryUiState, onBack: () -> Unit, onStart: () -> Unit, onArrive: () -> Unit, onQr: () -> Unit, onReport: () -> Unit) {
    val stop = state.stop ?: return
    val context = LocalContext.current
    FieldScreen(
        title = stop.counterpartyName,
        eyebrow = stringResource(R.string.delivery_stop_eyebrow, stop.sequenceNumber),
        onBack = onBack,
        headerExtra = {
            val eta = DayLogic.etaTo(state.position?.latitude, state.position?.longitude, stop)
            val meta = listOfNotNull(stop.partyAddress ?: stop.partyPlace, eta?.let { stringResource(R.string.eta, DayLogic.kmLabel(it.km), it.minutes) }).joinToString(" · ")
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = Fresh.onCarbonMuted, modifier = Modifier.padding(top = 6.dp))
            Row(Modifier.padding(top = 12.dp)) {
                when {
                    !state.started || !state.isNext -> Pill(stringResource(R.string.locked), Tone.Neutral, onDark = true)
                    state.arrived -> Pill(stringResource(R.string.at_the_shop), Tone.Lime)
                    else -> Pill(stringResource(R.string.pill_next), Tone.Lime)
                }
            }
        },
        bottomBar = when {
            !state.started -> { { PrimaryAction(stringResource(R.string.start_trip), onStart, glyph = Glyph.Truck) } }
            !state.isNext -> null
            state.arrived -> { { PrimaryAction(stringResource(R.string.scan_customer_qr), onQr, glyph = Glyph.Qr) } }
            else -> { { PrimaryAction(stringResource(R.string.arrived_scan_qr), onArrive, glyph = Glyph.Pin) } }
        },
    ) {
        when {
            !state.started -> Callout(stringResource(R.string.start_trip_first), Tone.Attention, Glyph.Lock)
            !state.isNext -> Callout(stringResource(R.string.deliver_first, state.next?.counterpartyName.orEmpty()), Tone.Attention, Glyph.Lock)
        }
        FieldCard {
            Eyebrow(stringResource(R.string.what_to_deliver))
            state.items.forEach { item ->
                Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text(item.productName, style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                    Text(amount(item.quantity, item.uom), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                }
            }
            if (stop.collectTerms != null) {
                Text(
                    if (stop.collectTerms == "cash") stringResource(R.string.collect_amount, DayLogic.rupees(stop.collectAmount)) else stringResource(R.string.on_credit),
                    style = MaterialTheme.typography.labelLarge,
                    color = Fresh.primary,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TonalAction(stringResource(R.string.call), Glyph.Phone, Fresh.surface, Fresh.primary, Modifier.weight(1f), enabled = stop.partyPhone != null) {
                stop.partyPhone?.let { FieldIntents.dial(context, it) }
            }
            TonalAction(
                stringResource(R.string.start_navigation),
                Glyph.Navigate,
                Fresh.primaryTint,
                Fresh.primaryStrong,
                Modifier.weight(1f),
                enabled = stop.partyLatitude != null || stop.partyAddress != null || stop.partyPlace != null,
            ) {
                val opened = FieldIntents.navigate(context, stop.partyLatitude, stop.partyLongitude, stop.counterpartyName, stop.partyAddress ?: stop.partyPlace)
                if (!opened) Toast.makeText(context, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
            }
        }
        if (state.started && state.isNext) SecondaryAction(stringResource(R.string.skip_or_report), onReport, glyph = Glyph.Warning)
    }
}

// ---------------------------------------------------------------------------
// Scan customer QR (design sheet screen 10)
// ---------------------------------------------------------------------------

@Composable
private fun ScanQr(
    state: DeliveryUiState,
    draft: DeliveryDraft,
    onBack: () -> Unit,
    onScan: () -> Unit,
    onNotScanned: (String) -> Unit,
    onContinue: () -> Unit,
) {
    val stop = state.stop ?: return
    var noQr by rememberSaveable { mutableStateOf(draft.qr == QrState.NOT_SCANNED) }
    FieldScreen(
        title = stringResource(R.string.scan_customer_qr),
        eyebrow = stop.counterpartyName,
        onBack = onBack,
        bottomBar = {
            if (draft.qr == QrState.NONE) PrimaryAction(stringResource(R.string.scan_qr), onScan, glyph = Glyph.Qr)
            else PrimaryAction(stringResource(R.string.continue_label), onContinue)
        },
    ) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Fresh.carbon).padding(vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.size(132.dp).clip(RoundedCornerShape(20.dp)).background(Color.White), contentAlignment = Alignment.Center) {
                GlyphIcon(Glyph.Qr, Fresh.ink, size = 96.dp)
            }
            Text(stop.counterpartyName, style = MaterialTheme.typography.titleLarge, color = Fresh.onCarbon, modifier = Modifier.padding(top = 16.dp))
            Text(stringResource(R.string.scan_hint), style = MaterialTheme.typography.bodyMedium, color = Fresh.onCarbonMuted, modifier = Modifier.padding(top = 4.dp, start = 16.dp, end = 16.dp))
        }
        when (draft.qr) {
            QrState.VERIFIED -> Callout(stringResource(R.string.customer_verified, stop.counterpartyName), Tone.Good, Glyph.Check)
            QrState.NOT_SCANNED -> Callout(stringResource(R.string.not_scanned_because, stringResource(QR_NOTES.firstOrNull { it.first == draft.qrNote }?.second ?: R.string.reason_other)), Tone.Attention)
            QrState.NONE -> if (state.wrongQr) Callout(stringResource(R.string.wrong_qr, stop.counterpartyName), Tone.Bad)
        }
        if (draft.qr != QrState.VERIFIED) {
            if (!noQr) {
                SecondaryAction(stringResource(R.string.qr_missing_or_damaged), { noQr = true }, glyph = Glyph.Warning)
            } else {
                FieldCard {
                    Eyebrow(stringResource(R.string.why_not_scanned))
                    Text(stringResource(R.string.no_qr_hint), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 4.dp, bottom = 10.dp))
                    ChoiceTiles(QR_NOTES.map { (note, label) -> note to stringResource(label) }, draft.qrNote.orEmpty(), onNotScanned)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Deliver items (design sheet screen 11)
// ---------------------------------------------------------------------------

@Composable
private fun DeliverItems(
    state: DeliveryUiState,
    draft: DeliveryDraft,
    onBack: () -> Unit,
    onEdit: ((DeliveryDraft) -> DeliveryDraft) -> Unit,
    onPhoto: (String, String) -> Unit,
    onScalePhoto: (String, String) -> Unit,
    onComplete: () -> Unit,
    photo: PhotoSlot,
    onReport: () -> Unit,
) {
    val stop = state.stop ?: return
    val readiness = DeliveryLogic.readinessOf(draft, state.items)
    FieldScreen(
        title = stop.counterpartyName,
        eyebrow = stringResource(R.string.deliver_items),
        onBack = onBack,
        headerExtra = {
            Row(Modifier.padding(top = 12.dp)) {
                if (draft.qr == QrState.VERIFIED) Pill(stringResource(R.string.verified), Tone.Lime)
                else Pill(stringResource(R.string.qr_not_scanned), Tone.Attention)
            }
        },
        bottomBar = { HoldToConfirm(stringResource(R.string.hold_to_complete_delivery), onComplete, enabled = readiness.ready) },
    ) {
        state.items.filter { it.orderLineId != null }.forEach { item ->
            val line = draft.lines.firstOrNull { it.orderLineId == item.orderLineId } ?: return@forEach
            DeliverLineCard(item, line) { change -> onEdit { d -> d.copy(lines = d.lines.map { if (it.orderLineId == line.orderLineId) change(it) else it }) } }
        }

        FieldCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.all_unloaded_question), style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                Text(stringResource(if (draft.allUnloaded) R.string.yes else R.string.no), style = MaterialTheme.typography.labelLarge, color = if (draft.allUnloaded) Fresh.primary else Fresh.inkMuted)
                Spacer(Modifier.width(10.dp))
                Switch(
                    checked = draft.allUnloaded,
                    onCheckedChange = { on -> onEdit { it.copy(allUnloaded = on) } },
                    colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = Fresh.primary),
                )
            }
        }

        if (state.crateTypes.isNotEmpty()) {
            FieldCard {
                Eyebrow(stringResource(R.string.crates))
                state.crateTypes.forEach { type ->
                    val c = draft.crates.firstOrNull { it.crateTypeId == type.id } ?: return@forEach
                    fun set(change: (CrateDraft) -> CrateDraft) = onEdit { d -> d.copy(crates = d.crates.map { if (it.crateTypeId == type.id) change(it) else it }) }
                    Text(type.name, style = MaterialTheme.typography.titleSmall, color = Fresh.ink, modifier = Modifier.padding(top = 10.dp))
                    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        FreshTextField(c.dropped, { v -> set { it.copy(dropped = v.filter(Char::isDigit).take(5)) } }, stringResource(R.string.crates_sent), Modifier.weight(1f), keyboardType = KeyboardType.Number)
                        FreshTextField(c.collected, { v -> set { it.copy(collected = v.filter(Char::isDigit).take(5)) } }, stringResource(R.string.crates_returned), Modifier.weight(1f), keyboardType = KeyboardType.Number)
                    }
                }
            }
        }

        FreshTextField(draft.recipient, { v -> onEdit { it.copy(recipient = v.take(120)) } }, stringResource(R.string.received_by), leading = Glyph.User)
        photo(
            stringResource(if (draft.podPhotos > 0) R.string.photo_delivery_another else R.string.photo_delivery),
            false,
            onPhoto,
        )
        val weighed = state.items.any { item -> item.kind == "live_bird" && draft.lines.any { it.orderLineId == item.orderLineId && it.customerWeight.isNotBlank() } }
        if (weighed) photo(stringResource(if (draft.scalePhotos > 0) R.string.photo_scale_attached else R.string.photo_scale), draft.scalePhotos > 0, onScalePhoto)

        FieldCard {
            CheckLine(stringResource(R.string.check_qr), readiness.qr)
            CheckLine(stringResource(R.string.check_quantities), readiness.quantities)
            CheckLine(stringResource(R.string.check_unloaded), readiness.unloaded)
            CheckLine(stringResource(R.string.check_photo), readiness.photo)
        }
        SecondaryAction(stringResource(R.string.skip_or_report), onReport, glyph = Glyph.Warning)
    }
}

@Composable
private fun DeliverLineCard(item: StopItemResponse, line: DeliveryLineDraft, onChange: ((DeliveryLineDraft) -> DeliveryLineDraft) -> Unit) {
    val decimal = { typed: String -> typed.filter { it.isDigit() || it == '.' }.take(10) }
    val short = DeliveryLogic.isShort(line, item)
    val problem = DeliveryLogic.problemOf(line, item)
    FieldCard(highlight = short) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(item.productName, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                Text(stringResource(R.string.ordered_amount, amount(item.quantity, item.uom)), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
            }
            FreshTextField(
                line.delivered,
                { v -> onChange { it.copy(delivered = decimal(v)) } },
                stringResource(R.string.delivered_label, if (item.uom == "piece") stringResource(R.string.eggs) else item.uom),
                Modifier.width(150.dp),
                keyboardType = KeyboardType.Decimal,
            )
        }
        if (item.kind == "live_bird") {
            FreshTextField(line.customerWeight, { v -> onChange { it.copy(customerWeight = decimal(v)) } }, stringResource(R.string.customer_scale), Modifier.padding(top = 10.dp), keyboardType = KeyboardType.Decimal)
        }
        if (item.kind == "egg") {
            FreshTextField(line.broken, { v -> onChange { it.copy(broken = v.filter(Char::isDigit).take(6)) } }, stringResource(R.string.broken_eggs), Modifier.padding(top = 10.dp), keyboardType = KeyboardType.Number)
        }
        if (short) {
            Text(stringResource(R.string.why_short), style = MaterialTheme.typography.labelLarge, color = Fresh.warning, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
            ChoiceTiles(SHORT_REASONS.map { it to stringResource(shortLabel(it)) }, line.shortReason.orEmpty()) { r -> onChange { it.copy(shortReason = r) } }
            FreshTextField(line.shortNote, { v -> onChange { it.copy(shortNote = v.take(300)) } }, stringResource(R.string.notes_optional), Modifier.padding(top = 10.dp))
        }
        when (problem) {
            DeliveryProblem.BAD_NUMBER -> Text(stringResource(R.string.number_only), style = MaterialTheme.typography.bodySmall, color = Fresh.critical, modifier = Modifier.padding(top = 6.dp))
            DeliveryProblem.TOO_MANY_BROKEN -> Text(stringResource(R.string.more_than_loaded), style = MaterialTheme.typography.bodySmall, color = Fresh.critical, modifier = Modifier.padding(top = 6.dp))
            else -> Unit
        }
    }
}

@Composable
private fun CheckLine(text: String, done: Boolean) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(22.dp).clip(CircleShape).background(if (done) Fresh.primary else Fresh.surface3), contentAlignment = Alignment.Center) {
            if (done) GlyphIcon(Glyph.Check, Color.White, size = 13.dp)
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = if (done) Fresh.ink else Fresh.inkMuted)
    }
}

// ---------------------------------------------------------------------------
// A completed delivery
// ---------------------------------------------------------------------------

@Composable
private fun CompletedDelivery(state: DeliveryUiState, onBack: () -> Unit, onCollect: () -> Unit) {
    val stop = state.stop ?: return
    val outcome = state.outcome
    FieldScreen(
        title = stop.counterpartyName,
        eyebrow = stringResource(R.string.delivery_stop_eyebrow, stop.sequenceNumber),
        onBack = onBack,
        headerExtra = {
            Row(Modifier.padding(top = 12.dp)) {
                if (stop.pendingSync) Pill(stringResource(R.string.saving), Tone.Attention)
                else Pill(stringResource(if (stop.status == "completed") R.string.delivered else R.string.pill_skipped), Tone.Lime)
            }
        },
        bottomBar = if (stop.status == "completed" && stop.collectTerms == "cash") {
            { PrimaryAction(stringResource(R.string.collect_payment), onCollect, glyph = Glyph.Rupee) }
        } else {
            null
        },
    ) {
        if (outcome == null) {
            Callout(stringResource(if (stop.status == "completed") R.string.stop_done else R.string.stop_skipped), if (stop.status == "completed") Tone.Good else Tone.Attention)
            return@FieldScreen
        }
        FieldCard {
            Text(
                when (outcome.qrStatus) {
                    "scanned" -> stringResource(R.string.customer_verified, stop.counterpartyName)
                    "not_scanned" -> stringResource(R.string.not_scanned_because, outcome.qrNote ?: "—")
                    else -> stringResource(R.string.qr_not_scanned)
                },
                style = MaterialTheme.typography.titleMedium,
                color = if (outcome.qrStatus == "scanned") Fresh.primary else Fresh.warning,
            )
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
            Text(stringResource(R.string.received_by_name, outcome.recipientName), style = MaterialTheme.typography.bodyLarge, color = Fresh.ink)
            if (outcome.crates.dropped > 0 || outcome.crates.collected > 0) {
                Text(
                    stringResource(R.string.crates_left_back, outcome.crates.dropped, outcome.crates.collected),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Fresh.ink,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        if (outcome.shortfalls.isNotEmpty()) {
            FieldCard {
                Eyebrow(stringResource(R.string.delivered_short))
                outcome.shortfalls.forEach { s ->
                    Text(
                        stringResource(R.string.short_line, s.productName, amount(s.delivered, s.uom), amount(s.ordered, s.uom)),
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = Fresh.ink,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Text(
                        listOfNotNull(stringResource(shortLabel(s.reason)), s.note).joinToString(" — "),
                        style = MaterialTheme.typography.bodySmall,
                        color = Fresh.warning,
                    )
                }
            }
        }
        SecondaryAction(stringResource(R.string.back_to_deliveries), onBack, glyph = Glyph.Back)
    }
}
