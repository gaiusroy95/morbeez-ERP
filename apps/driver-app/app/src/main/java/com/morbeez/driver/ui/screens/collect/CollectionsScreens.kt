package com.morbeez.driver.ui.screens.collect

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldIntents
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.HoldToConfirm
import com.morbeez.driver.ui.components.PhotoCaptureButton
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.Stat
import com.morbeez.driver.ui.components.TonalAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.components.rememberLeaveGuard
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.theme.Fresh
import java.math.BigDecimal

private val cameraPhoto: PhotoSlot = { label, captured, onCaptured -> PhotoCaptureButton(label = label, onCaptured = onCaptured, captured = captured) }

private fun rupees(b: BigDecimal?) = DayLogic.rupees(b?.toPlainString())

@Composable
fun methodLabel(method: String): String = stringResource(
    when (method) {
        "cash" -> R.string.method_cash
        "upi" -> R.string.method_upi
        "bank_transfer" -> R.string.method_bank
        else -> R.string.method_cheque
    },
)

// ---------------------------------------------------------------------------
// Collections (design sheet screens 15 and 17)
// ---------------------------------------------------------------------------

@Composable
fun CollectionsScreen(onBack: () -> Unit, onCollect: (tripId: String, stopId: String) -> Unit, onReturn: () -> Unit, viewModel: CollectionsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    CollectionsContent(state, onBack, onCollect, onReturn)
}

/**
 * Collections (client spec §18–§20): only the customers delivered on this
 * trip, each with their whole outstanding; a partial payment keeps them on
 * the list with what's left; what was collected, by how it was paid.
 */
@Composable
internal fun CollectionsContent(state: CollectionsUiState, onBack: () -> Unit, onCollect: (String, String) -> Unit, onReturn: () -> Unit) {
    val context = LocalContext.current
    var collectedTab by rememberSaveable { mutableStateOf(false) }
    val (pendingCount, pendingAmount) = state.pending
    val shown = state.rows.filter { it.settled == collectedTab }
    FieldScreen(
        title = stringResource(R.string.drawer_collections),
        eyebrow = state.trip?.number,
        onBack = onBack,
        headerExtra = {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Stat(stringResource(R.string.delivered), "${state.rows.size}", onDark = true, modifier = Modifier.weight(1f))
                Stat(stringResource(R.string.pending), "$pendingCount", onDark = true, modifier = Modifier.weight(1f))
                Stat(stringResource(R.string.balance), stringResource(R.string.rupees, rupees(pendingAmount)), onDark = true, modifier = Modifier.weight(1.4f))
            }
        },
        bottomBar = if (state.trip?.status == "in_progress" && state.deliveriesDone) {
            { PrimaryAction(stringResource(R.string.return_to_base), onReturn, glyph = Glyph.Truck) }
        } else {
            null
        },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Segment(stringResource(R.string.pending_n, pendingCount), !collectedTab, Modifier.weight(1f)) { collectedTab = false }
            Segment(stringResource(R.string.collected_n, state.rows.size - pendingCount), collectedTab, Modifier.weight(1f)) { collectedTab = true }
        }
        if (state.rows.isEmpty()) Callout(stringResource(R.string.nothing_to_collect_yet), Tone.Active)
        else if (shown.isEmpty()) Text(stringResource(R.string.no_stops_here), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        shown.forEach { row ->
            FieldCard {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(row.name, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                        row.place?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted) }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(stringResource(R.string.outstanding), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                        Text(
                            row.outstanding?.let { stringResource(R.string.rupees, rupees(it)) } ?: stringResource(R.string.after_sync),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = if (row.settled) Fresh.primary else Fresh.ink,
                        )
                    }
                }
                if (row.collectedOnTrip.signum() > 0) {
                    Text(stringResource(R.string.collected_on_trip, rupees(row.collectedOnTrip)), style = MaterialTheme.typography.bodySmall, color = Fresh.primary, modifier = Modifier.padding(top = 6.dp))
                }
                if (row.disputed.signum() > 0) {
                    Text(stringResource(R.string.disputed_with_owner, rupees(row.disputed)), style = MaterialTheme.typography.bodySmall, color = Fresh.warning, modifier = Modifier.padding(top = 2.dp))
                }
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TonalAction(stringResource(R.string.call), Glyph.Phone, Fresh.surface2, Fresh.primary, Modifier.weight(1f), enabled = row.phone != null) {
                        row.phone?.let { FieldIntents.dial(context, it) }
                    }
                    TonalAction(stringResource(R.string.collect), Glyph.Rupee, Fresh.primaryTint, Fresh.primaryStrong, Modifier.weight(1f), enabled = !row.settled && state.trip != null) {
                        state.trip?.let { onCollect(it.id, row.stopId) }
                    }
                }
            }
        }

        FieldCard {
            Eyebrow(stringResource(R.string.collected_today))
            listOf("cash" to state.collected.cash, "upi" to state.collected.upi, "bank_transfer" to state.collected.bankTransfer, "cheque" to state.collected.cheque)
                .filter { (m, v) -> v.signum() > 0 || m != "cheque" }
                .forEach { (method, amount) ->
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                        Text(methodLabel(method), style = MaterialTheme.typography.bodyLarge, color = Fresh.ink, modifier = Modifier.weight(1f))
                        Text(stringResource(R.string.rupees, rupees(amount)), style = MaterialTheme.typography.bodyLarge, color = Fresh.ink)
                    }
                }
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
            Row(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.total_collected), style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                Text(stringResource(R.string.rupees, rupees(state.collected.total)), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), color = Fresh.primary)
            }
            if (pendingCount > 0) {
                Text(
                    pluralStringResource(R.plurals.pending_customers, pendingCount, pendingCount, rupees(pendingAmount)),
                    style = MaterialTheme.typography.bodySmall,
                    color = Fresh.warning,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Text(stringResource(R.string.only_delivered_shown), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
private fun Segment(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Fresh.carbon else Fresh.surface)
            .border(1.dp, if (selected) Fresh.carbon else Fresh.borderStrong, RoundedCornerShape(14.dp))
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (selected) Fresh.onCarbon else Fresh.ink)
    }
}

// ---------------------------------------------------------------------------
// Record collection (design sheet screen 16)
// ---------------------------------------------------------------------------

@Composable
fun RecordCollectionScreen(onBack: () -> Unit, onDone: () -> Unit, viewModel: RecordCollectionViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val sent by viewModel.disputeSent.collectAsStateWithLifecycle()
    RecordCollectionContent(
        row = state.rows.firstOrNull { it.stopId == viewModel.stopId },
        disputeSent = sent,
        onBack = onBack,
        onReceive = { amount, method, reference, payer, notes -> viewModel.receive(amount, method, reference, payer, notes, onDone) },
        onDispute = viewModel::dispute,
        onProof = viewModel::proofPhoto,
    )
}

/**
 * A payment from one customer (client spec §19–§21): against what they owe
 * in all; cash, UPI, transfer or cheque, with its reference; paid by the
 * customer or someone on their behalf; proof; and a disputed amount sent to
 * the owner, never written off here.
 */
@Composable
internal fun RecordCollectionContent(
    row: CollectRow?,
    disputeSent: Boolean,
    onBack: () -> Unit,
    onReceive: (amount: Double, method: String, reference: String?, payerName: String?, notes: String?) -> Unit,
    onDispute: (amount: Double, reason: String) -> Unit,
    onProof: (String, String) -> Unit,
    photo: PhotoSlot = cameraPhoto,
) {
    if (row == null) {
        FieldScreen(title = stringResource(R.string.record_collection), onBack = onBack) { Callout(stringResource(R.string.nothing_to_collect_yet), Tone.Active) }
        return
    }
    val owed = row.remaining?.takeIf { it.signum() > 0 }?.stripTrailingZeros()?.toPlainString().orEmpty()
    var amount by rememberSaveable(row.stopId) { mutableStateOf(owed) }
    var method by rememberSaveable { mutableStateOf("cash") }
    var reference by rememberSaveable { mutableStateOf("") }
    var someoneElse by rememberSaveable { mutableStateOf(false) }
    var payerName by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var proof by rememberSaveable { mutableStateOf(false) }
    var disputing by rememberSaveable { mutableStateOf(false) }
    var disputeAmount by rememberSaveable { mutableStateOf("") }
    var disputeReason by rememberSaveable { mutableStateOf("") }
    val problem = CollectionsLogic.amountProblem(amount, row.remaining)
    val ready = problem == null && (!someoneElse || payerName.isNotBlank())
    val money = { typed: String -> typed.filter { it.isDigit() || it == '.' }.take(10) }
    // Anything the driver changed or typed isn't lost to a stray Back (D8).
    val dirty = amount != owed || method != "cash" || reference.isNotBlank() || someoneElse || notes.isNotBlank() || proof || disputing
    val leave = rememberLeaveGuard(dirty, onBack)

    FieldScreen(
        title = row.name,
        eyebrow = stringResource(R.string.record_collection),
        onBack = leave,
        headerExtra = {
            Text(stringResource(R.string.outstanding_balance), style = MaterialTheme.typography.bodyMedium, color = Fresh.onCarbonMuted, modifier = Modifier.padding(top = 8.dp))
            Text(
                row.outstanding?.let { stringResource(R.string.rupees, rupees(it)) } ?: stringResource(R.string.after_sync),
                style = MaterialTheme.typography.headlineMedium,
                color = Fresh.onCarbon,
            )
            if (row.disputed.signum() > 0) Pill(stringResource(R.string.disputed_with_owner, rupees(row.disputed)), Tone.Attention)
        },
        bottomBar = {
            HoldToConfirm(
                stringResource(R.string.hold_to_receive, DayLogic.rupees(amount.ifBlank { "0" })),
                { amount.trim().toDoubleOrNull()?.let { onReceive(it, method, reference.takeIf { method != "cash" }, payerName.takeIf { someoneElse }, notes) } },
                enabled = ready,
            )
        },
    ) {
        FreshTextField(amount, { amount = money(it) }, stringResource(R.string.amount_received), keyboardType = KeyboardType.Decimal, prefix = "₹")
        when (problem) {
            AmountProblem.BAD_NUMBER -> Text(stringResource(R.string.number_only), style = MaterialTheme.typography.bodySmall, color = Fresh.critical)
            AmountProblem.MORE_THAN_OWED -> Text(stringResource(R.string.more_than_owed, rupees(row.remaining)), style = MaterialTheme.typography.bodySmall, color = Fresh.critical)
            else -> Unit
        }
        FieldCard {
            Eyebrow(stringResource(R.string.payment_method))
            ChoiceTiles(PAYMENT_METHODS.map { it to methodLabel(it) }, method) { method = it }
            if (method != "cash") {
                FreshTextField(reference, { reference = it.take(60) }, stringResource(R.string.reference_utr), Modifier.padding(top = 12.dp))
            }
            Text(
                stringResource(if (method == "cash") R.string.cash_to_hand_over_note else R.string.direct_note),
                style = MaterialTheme.typography.bodySmall,
                color = Fresh.inkMuted,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        FieldCard {
            Eyebrow(stringResource(R.string.paid_by))
            ChoiceTiles(listOf("customer" to stringResource(R.string.paid_by_customer), "other" to stringResource(R.string.paid_by_someone_else)), if (someoneElse) "other" else "customer") {
                someoneElse = it == "other"
            }
            if (someoneElse) FreshTextField(payerName, { payerName = it.take(120) }, stringResource(R.string.who_paid), Modifier.padding(top = 12.dp), leading = Glyph.User)
        }
        photo(stringResource(if (proof) R.string.photo_attached else R.string.photo_payment_proof), proof) { path, mime ->
            onProof(path, mime)
            proof = true
        }
        FreshTextField(notes, { notes = it.take(300) }, stringResource(R.string.notes_optional), singleLine = false)

        if (disputeSent) {
            Callout(stringResource(R.string.dispute_sent), Tone.Good, Glyph.Check)
        } else if (!disputing) {
            SecondaryAction(stringResource(R.string.customer_disputes), { disputing = true }, glyph = Glyph.Warning)
        } else {
            FieldCard {
                Eyebrow(stringResource(R.string.disputed_amount))
                Text(stringResource(R.string.dispute_hint), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
                FreshTextField(disputeAmount, { disputeAmount = money(it) }, stringResource(R.string.amount_rupees), keyboardType = KeyboardType.Decimal, prefix = "₹")
                FreshTextField(disputeReason, { disputeReason = it.take(500) }, stringResource(R.string.what_they_dispute), Modifier.padding(top = 10.dp), singleLine = false)
                val disputeOk = CollectionsLogic.amountProblem(disputeAmount, row.remaining) == null && disputeReason.trim().length >= 3
                SecondaryAction(
                    stringResource(R.string.send_to_owner),
                    { disputeAmount.toDoubleOrNull()?.let { onDispute(it, disputeReason) } },
                    Modifier.padding(top = 12.dp),
                    glyph = Glyph.Arrow,
                    enabled = disputeOk,
                )
            }
        }
    }
}
