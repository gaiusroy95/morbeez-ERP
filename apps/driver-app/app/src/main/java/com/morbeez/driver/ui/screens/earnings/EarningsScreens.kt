package com.morbeez.driver.ui.screens.earnings

import androidx.compose.foundation.background
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.data.remote.dto.DriverSettlementResponse
import com.morbeez.driver.data.remote.dto.EarningsLineResponse
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.HoldToConfirm
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.SegmentTabs
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.components.drawGlow
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.clockOf
import com.morbeez.driver.ui.screens.records.RecordsFormat
import com.morbeez.driver.ui.theme.Fresh

private fun rupees(v: String?) = DayLogic.rupees(v ?: "0")

/** Each incentive's name and what it rewards, as the design sheet puts them. */
@Composable
fun incentiveTitle(kind: String): String = stringResource(
    when (kind) {
        "collection" -> R.string.inc_collection
        "backhaul" -> R.string.inc_backhaul
        "mileage" -> R.string.inc_mileage
        "crates" -> R.string.inc_crates
        "quality" -> R.string.inc_quality
        "new_customer" -> R.string.inc_new_customer
        "performance" -> R.string.inc_performance
        "night_duty" -> R.string.inc_night_duty
        "data_quality" -> R.string.inc_data_quality
        else -> R.string.inc_completion
    },
)

@Composable
private fun incentiveSub(kind: String): String = stringResource(
    when (kind) {
        "collection" -> R.string.inc_collection_sub
        "backhaul" -> R.string.inc_backhaul_sub
        "mileage" -> R.string.inc_mileage_sub
        "crates" -> R.string.inc_crates_sub
        "quality" -> R.string.inc_quality_sub
        "new_customer" -> R.string.inc_new_customer_sub
        "performance" -> R.string.inc_performance_sub
        "night_duty" -> R.string.inc_night_duty_sub
        "data_quality" -> R.string.inc_data_quality_sub
        else -> R.string.inc_completion_sub
    },
)

private fun incentiveGlyph(kind: String): Glyph = when (kind) {
    "collection" -> Glyph.Rupee
    "backhaul" -> Glyph.Truck
    "mileage" -> Glyph.Gauge
    "crates" -> Glyph.Box
    "quality" -> Glyph.Shield
    "new_customer" -> Glyph.User
    "performance" -> Glyph.Chevrons
    "night_duty" -> Glyph.Clock
    "data_quality" -> Glyph.File
    else -> Glyph.Check
}

// ---------------------------------------------------------------------------
// My Earnings (design sheet 3)
// ---------------------------------------------------------------------------

@Composable
fun MyEarningsScreen(onBack: () -> Unit, onSettlements: () -> Unit, viewModel: EarningsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    MyEarningsContent(state, onBack, onSettlements, viewModel::refresh)
}

/**
 * My Earnings: today's, this week's or this month's fixed pay and each
 * incentive the owner pays — calculated by the server from the work done,
 * never entered; a trip not closed yet counts as an estimate.
 */
@Composable
internal fun MyEarningsContent(state: EarningsUiState, onBack: () -> Unit, onSettlements: () -> Unit, onRefresh: () -> Unit, initialPeriod: String = "today") {
    var period by rememberSaveable { mutableStateOf(initialPeriod) }
    val e = state.of(period)
    FieldScreen(title = stringResource(R.string.drawer_earnings), onBack = onBack) {
        SegmentTabs(
            listOf("today" to stringResource(R.string.earn_today), "week" to stringResource(R.string.earn_week), "month" to stringResource(R.string.earn_month)),
            period,
            { period = it },
        )
        TotalCard(
            stringResource(
                when (period) {
                    "today" -> R.string.earn_total_today
                    "month" -> R.string.earn_total_month
                    else -> R.string.earn_total_week
                },
            ),
            e?.total,
        )
        if (e == null) {
            Callout(stringResource(R.string.records_not_yet), Tone.Active, Glyph.Sync)
        } else {
            FieldCard {
                EarningRow(Glyph.Wallet, stringResource(R.string.inc_fixed_pay), stringResource(R.string.inc_fixed_pay_sub), e.fixedPay, estimated = false)
                EarningsLogic.linesOf(e).forEach { line ->
                    HorizontalDivider(color = Fresh.border)
                    IncentiveRow(line)
                }
                HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(top = 4.dp))
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(14.dp)).background(Fresh.primaryTint).padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(stringResource(R.string.earn_total), style = MaterialTheme.typography.titleMedium, color = Fresh.primaryStrong, modifier = Modifier.weight(1f))
                    Text(stringResource(R.string.rupees, rupees(e.total)), style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold), color = Fresh.primaryStrong)
                }
            }
            if (EarningsLogic.hasEstimate(e)) Callout(stringResource(R.string.earn_estimate, rupees(e.estimated)), Tone.Attention, Glyph.Clock)
        }
        Callout(stringResource(R.string.earn_calculated_note), Tone.Active, Glyph.Shield)
        SecondaryAction(stringResource(R.string.drawer_settlements), onSettlements, glyph = Glyph.File)
        UpdatedLine(state, onRefresh)
    }
}

@Composable
private fun TotalCard(label: String, total: String?) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Fresh.carbon).drawBehind { drawGlow() }.padding(20.dp),
    ) {
        Text(label, style = MaterialTheme.typography.titleMedium, color = Fresh.onCarbon)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
            Text(
                total?.let { stringResource(R.string.rupees, rupees(it)) } ?: "—",
                style = MaterialTheme.typography.headlineLarge.copy(fontWeight = FontWeight.Bold),
                color = Fresh.onCarbon,
                modifier = Modifier.weight(1f),
            )
            Pill(stringResource(R.string.earn_calculated), Tone.Lime)
        }
    }
}

@Composable
private fun IncentiveRow(line: EarningsLineResponse) {
    val estimated = (line.estimated.toBigDecimalOrNull()?.signum() ?: 0) > 0
    EarningRow(incentiveGlyph(line.kind), incentiveTitle(line.kind), incentiveSub(line.kind), line.amount, estimated)
}

@Composable
private fun EarningRow(glyph: Glyph, title: String, sub: String, amount: String, estimated: Boolean) {
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(Fresh.surface2), contentAlignment = Alignment.Center) {
            GlyphIcon(glyph, Fresh.primary, size = 18.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(stringResource(R.string.rupees, rupees(amount)), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), color = Fresh.ink)
            if (estimated) Text(stringResource(R.string.earn_est), style = MaterialTheme.typography.labelSmall, color = Fresh.warning)
        }
    }
}

@Composable
private fun UpdatedLine(state: EarningsUiState, onRefresh: () -> Unit) {
    val at = state.day?.refreshedAt?.let { clockOf(it) } ?: "—"
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            stringResource(if (state.online) R.string.records_updated else R.string.records_offline, at),
            style = MaterialTheme.typography.bodySmall,
            color = Fresh.inkFaint,
            modifier = Modifier.weight(1f),
        )
        if (state.online) {
            com.morbeez.driver.ui.components.TonalAction(stringResource(R.string.sync_now), Glyph.Sync, Fresh.surface2, Fresh.primary, onClick = onRefresh)
        }
    }
}

// ---------------------------------------------------------------------------
// Settlements (side drawer)
// ---------------------------------------------------------------------------

@Composable
fun SettlementsScreen(onBack: () -> Unit, viewModel: EarningsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SettlementsContent(state, onBack, viewModel::refresh, viewModel::received)
}

/**
 * Settlements: the driver's pay, settled weekly (the client's answer 8) —
 * what the owner approved, what was paid and how, every line of it; once
 * paid, the driver says they got it.
 */
@Composable
internal fun SettlementsContent(state: EarningsUiState, onBack: () -> Unit, onRefresh: () -> Unit, onReceived: (String) -> Unit) {
    FieldScreen(title = stringResource(R.string.drawer_settlements), eyebrow = stringResource(R.string.settle_eyebrow), onBack = onBack) {
        val list = state.settlements
        when {
            list == null -> Callout(stringResource(R.string.records_not_yet), Tone.Active, Glyph.Sync)
            list.isEmpty() -> Text(stringResource(R.string.settle_none), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
            else -> list.forEach { SettlementCard(it, EarningsLogic.standingOf(it, state.sending), onReceived) }
        }
        UpdatedLine(state, onRefresh)
    }
}

@Composable
private fun SettlementCard(s: DriverSettlementResponse, standing: PayStanding, onReceived: (String) -> Unit) {
    var open by rememberSaveable(s.id) { mutableStateOf(standing == PayStanding.PAID) }
    FieldCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Eyebrow(stringResource(R.string.settle_number, s.number))
                Text(
                    stringResource(R.string.settle_period, RecordsFormat.date(s.periodStart) ?: s.periodStart, RecordsFormat.date(s.periodEnd) ?: s.periodEnd),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.inkMuted,
                )
            }
            when (standing) {
                PayStanding.TO_BE_PAID -> Pill(stringResource(R.string.settle_to_be_paid), Tone.Attention)
                PayStanding.PAID -> Pill(stringResource(R.string.pill_paid), Tone.Good)
                PayStanding.SENDING -> Pill(stringResource(R.string.exp_unsent), Tone.Neutral)
                PayStanding.RECEIVED -> Pill(stringResource(R.string.settle_received), Tone.Good)
            }
        }
        Text(stringResource(R.string.rupees, rupees(s.net)), style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold), color = Fresh.ink, modifier = Modifier.padding(top = 8.dp))
        if (s.paidAt != null) {
            Text(
                stringResource(
                    R.string.settle_paid_line,
                    stringResource(if (s.paidFrom == "bank") R.string.settle_by_bank else R.string.settle_in_cash),
                    RecordsFormat.date(s.paidAt) ?: "",
                ) + (s.paymentReference?.let { " · $it" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = Fresh.inkMuted,
            )
        }
        if (open) {
            s.lines.forEach { l ->
                Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
                    Text(l.description, style = MaterialTheme.typography.bodySmall, color = Fresh.ink, modifier = Modifier.weight(1f))
                    val deduction = l.amount.startsWith("-")
                    Text(
                        (if (deduction) "− " else "") + stringResource(R.string.rupees, rupees(l.amount.removePrefix("-"))),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (deduction) Fresh.critical else Fresh.ink,
                    )
                }
            }
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 8.dp))
            Row(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.settle_gross), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.weight(1f))
                Text(stringResource(R.string.rupees, rupees(s.gross)), style = MaterialTheme.typography.bodySmall, color = Fresh.ink)
            }
            Row(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.settle_deductions), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.weight(1f))
                Text(stringResource(R.string.rupees, rupees(s.deductions)), style = MaterialTheme.typography.bodySmall, color = Fresh.ink)
            }
        }
        SecondaryAction(stringResource(if (open) R.string.settle_hide_lines else R.string.settle_show_lines), { open = !open }, modifier = Modifier.padding(top = 10.dp))
        if (standing == PayStanding.PAID) {
            Spacer(Modifier.padding(top = 10.dp))
            HoldToConfirm(stringResource(R.string.settle_hold_received), { onReceived(s.id) })
        }
        if (standing == PayStanding.RECEIVED) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
                Box(Modifier.size(22.dp).clip(CircleShape).background(Fresh.primary), contentAlignment = Alignment.Center) {
                    GlyphIcon(Glyph.Check, androidx.compose.ui.graphics.Color.White, size = 13.dp)
                }
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.settle_you_received, RecordsFormat.date(s.receivedAt) ?: ""), style = MaterialTheme.typography.bodySmall, color = Fresh.primaryStrong)
            }
        }
    }
}
