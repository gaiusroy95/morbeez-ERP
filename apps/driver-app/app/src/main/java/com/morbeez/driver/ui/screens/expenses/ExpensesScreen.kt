package com.morbeez.driver.ui.screens.expenses

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.data.remote.dto.HandoverResponse
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.Stat
import com.morbeez.driver.ui.components.StepTitle
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.theme.Fresh

private val CATEGORIES = listOf("fuel" to R.string.cat_fuel, "toll" to R.string.cat_toll, "labour" to R.string.cat_labour, "other" to R.string.cat_other)

/**
 * Trip summary and handover (DRV.19): what the trip spent, cash paid into
 * the bank on the road, the cash to hand over, and submitting the trip for
 * the owner's reconciliation. Only the owner closes it.
 */
@Composable
fun ExpensesScreen(tripId: String, onBack: (() -> Unit)? = null, viewModel: ExpensesViewModel = hiltViewModel()) {
    LaunchedEffect(tripId) { viewModel.load(tripId) }
    val expenses by viewModel.expenses.collectAsStateWithLifecycle()
    val handover by viewModel.handover.collectAsStateWithLifecycle()
    val trip by viewModel.trip.collectAsStateWithLifecycle()
    val stops by viewModel.stops.collectAsStateWithLifecycle()
    val total = expenses.sumOf { it.amount.toDoubleOrNull() ?: 0.0 }
    val status = trip?.status
    val pendingStops = stops.count { it.status == "pending" }
    val canSubmit = status == "in_progress" && pendingStops == 0

    FieldScreen(
        title = stringResource(R.string.summary_title),
        eyebrow = stringResource(R.string.summary_eyebrow),
        onBack = onBack,
        headerExtra = {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Stat(stringResource(R.string.to_hand_over), handover?.let { stringResource(R.string.rupees, it.expected) } ?: "—", onDark = true, modifier = Modifier.weight(1f))
                Stat(stringResource(R.string.spent), stringResource(R.string.rupees, "%,.0f".format(total)), onDark = true, modifier = Modifier.weight(1f))
            }
        },
    ) {
        when (status) {
            "completed" -> Callout(
                trip?.cashDeclared?.let { stringResource(R.string.submitted_callout_cash, it) } ?: stringResource(R.string.submitted_callout),
                tone = Tone.Good,
                glyph = Glyph.Check,
            )
            "on_hold" -> Callout(stringResource(R.string.on_hold_callout, trip?.reviewNote ?: stringResource(R.string.checking_it)), tone = Tone.Attention)
            "in_progress" -> trip?.reviewNote?.let {
                Callout(stringResource(R.string.returned_callout, it), tone = Tone.Attention)
            }
        }

        HandoverCard(handover)
        val level = trip?.authorityLevel
        if (level != null && level in 1..3 && (status == "in_progress" || status == "planned")) {
            // Spending is a full route operator's call (level 4); below it the owner approves at closure.
            Callout(stringResource(R.string.expense_approval_note), tone = Tone.Active)
        }
        ExpensesCard(tripId, expenses, editable = status == "in_progress" || status == "planned", viewModel)
        if (status == "in_progress" && (level == null || level >= 2)) DepositCard(tripId, viewModel)
        if (status == "in_progress") {
            SubmitCard(tripId, handover, canSubmit, pendingStops, viewModel)
        }
    }
}

/** opening cash + cash collected + spot cash − expenses − bank deposits = cash to hand over */
@Composable
private fun HandoverCard(handover: HandoverResponse?) {
    FieldCard {
        Eyebrow(stringResource(R.string.cash_to_hand_over), modifier = Modifier.padding(bottom = 6.dp))
        if (handover == null) {
            Text(
                stringResource(R.string.offline_total),
                style = MaterialTheme.typography.bodyMedium,
                color = Fresh.inkMuted,
            )
            return@FieldCard
        }
        Line(stringResource(R.string.opening_cash), handover.openingCash)
        Line(stringResource(R.string.plus_cash_collected), handover.cashCollections)
        Line(stringResource(R.string.plus_spot_cash), handover.spotCash)
        Line(stringResource(R.string.minus_expenses), handover.expenses)
        Line(stringResource(R.string.minus_deposited), handover.deposited)
        HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 8.dp))
        Line(stringResource(R.string.to_hand_over), handover.expected, bold = true)
        if (handover.directPayments.toDoubleOrNull() ?: 0.0 > 0.0) {
            Text(
                stringResource(R.string.direct_payments_note, handover.directPayments),
                style = MaterialTheme.typography.bodySmall,
                color = Fresh.inkMuted,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun Line(label: String, amount: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(
            label,
            style = if (bold) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium,
            color = if (bold) Fresh.ink else Fresh.inkMuted,
            modifier = Modifier.weight(1f),
        )
        Text(
            "₹$amount",
            style = if (bold) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = Fresh.ink,
        )
    }
}

@Composable
private fun ExpensesCard(tripId: String, expenses: List<com.morbeez.driver.data.remote.dto.TripExpenseResponse>, editable: Boolean, viewModel: ExpensesViewModel) {
    var category by remember { mutableStateOf(CATEGORIES.first().first) }
    var amountText by remember { mutableStateOf("") }
    val amount = amountText.toDoubleOrNull()

    FieldCard {
        Eyebrow(stringResource(R.string.expenses), modifier = Modifier.padding(bottom = 6.dp))
        if (expenses.isEmpty()) {
            Text(stringResource(R.string.nothing_yet), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(vertical = 8.dp))
        }
        expenses.forEachIndexed { i, expense ->
            if (i > 0) HorizontalDivider(color = Fresh.border)
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(Fresh.surface2), contentAlignment = Alignment.Center) {
                    GlyphIcon(if (expense.category == "fuel") Glyph.Fuel else Glyph.Rupee, Fresh.primary, size = 18.dp)
                }
                Spacer(Modifier.width(12.dp))
                Text(
                    CATEGORIES.firstOrNull { it.first == expense.category }?.let { stringResource(it.second) } ?: expense.category,
                    style = MaterialTheme.typography.titleSmall,
                    color = Fresh.ink,
                    modifier = Modifier.weight(1f),
                )
                Text(stringResource(R.string.rupees, expense.amount), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
            }
        }
        if (!editable) return@FieldCard
        HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 8.dp))
        Eyebrow(stringResource(R.string.add_expense_title), modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
        ChoiceTiles(CATEGORIES.map { (k, label) -> k to stringResource(label) }, category) { category = it }
        FreshTextField(
            value = amountText,
            onValueChange = { amountText = it },
            label = stringResource(R.string.amount_rupees),
            keyboardType = KeyboardType.Decimal,
            leading = Glyph.Rupee,
            modifier = Modifier.padding(top = 12.dp),
        )
        SecondaryAction(
            text = stringResource(R.string.add_expense),
            onClick = {
                if (amount != null && amount > 0) {
                    viewModel.recordExpense(tripId, category, amount, null)
                    amountText = ""
                }
            },
            enabled = amount != null && amount > 0,
            glyph = Glyph.Check,
            modifier = Modifier.padding(top = 14.dp),
        )
    }
}

/** Cash paid into the bank on the road (handover case C). */
@Composable
private fun DepositCard(tripId: String, viewModel: ExpensesViewModel) {
    var amountText by remember { mutableStateOf("") }
    var account by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }
    val amount = amountText.toDoubleOrNull()
    val ready = amount != null && amount > 0 && account.isNotBlank() && reference.isNotBlank()

    FieldCard {
        Eyebrow(stringResource(R.string.deposit_title), modifier = Modifier.padding(bottom = 6.dp))
        Text(
            stringResource(R.string.deposit_hint),
            style = MaterialTheme.typography.bodySmall,
            color = Fresh.inkMuted,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        FreshTextField(amountText, { amountText = it; saved = false }, stringResource(R.string.amount_rupees), keyboardType = KeyboardType.Decimal, leading = Glyph.Rupee)
        FreshTextField(account, { account = it }, stringResource(R.string.bank_account), modifier = Modifier.padding(top = 10.dp))
        FreshTextField(reference, { reference = it }, stringResource(R.string.slip_reference), modifier = Modifier.padding(top = 10.dp))
        if (saved) Callout(stringResource(R.string.deposit_recorded), tone = Tone.Good, glyph = Glyph.Check)
        SecondaryAction(
            text = stringResource(R.string.record_deposit),
            onClick = {
                viewModel.recordDeposit(tripId, amount ?: 0.0, account.trim(), reference.trim())
                amountText = ""
                reference = ""
                saved = true
            },
            enabled = ready,
            glyph = Glyph.Check,
            modifier = Modifier.padding(top = 14.dp),
        )
    }
}

/** Submit the trip for the owner, saying how much cash is being handed over. */
@Composable
private fun SubmitCard(tripId: String, handover: HandoverResponse?, canSubmit: Boolean, pendingStops: Int, viewModel: ExpensesViewModel) {
    var cashText by remember(handover?.expected) { mutableStateOf(handover?.expected ?: "") }
    var note by remember { mutableStateOf("") }
    val cash = cashText.toDoubleOrNull()

    FieldCard(highlight = canSubmit) {
        StepTitle(1, stringResource(R.string.hand_over_cash))
        FreshTextField(cashText, { cashText = it }, stringResource(R.string.cash_handing_over), keyboardType = KeyboardType.Decimal, leading = Glyph.Rupee)
        val expected = handover?.expected?.toDoubleOrNull()
        if (expected != null && cash != null && kotlin.math.abs(cash - expected) >= 0.01) {
            Callout(
                if (cash < expected) stringResource(R.string.less_than_expected, "%.2f".format(expected - cash))
                else stringResource(R.string.more_than_expected, "%.2f".format(cash - expected)),
                tone = Tone.Attention,
            )
        }
        FreshTextField(note, { note = it }, stringResource(R.string.note_for_owner), singleLine = false, modifier = Modifier.padding(top = 10.dp))
        Spacer(Modifier.padding(top = 14.dp))
        StepTitle(2, stringResource(R.string.submit_step))
        if (!canSubmit) {
            Text(
                stringResource(R.string.finish_stops_first, pendingStops),
                style = MaterialTheme.typography.bodyMedium,
                color = Fresh.inkMuted,
                modifier = Modifier.padding(bottom = 10.dp),
            )
        }
        PrimaryAction(
            text = stringResource(R.string.submit_trip),
            onClick = { viewModel.submit(tripId, cash ?: 0.0, note.trim().ifEmpty { null }) },
            enabled = canSubmit && cash != null && cash >= 0,
            glyph = Glyph.Check,
        )
    }
}
