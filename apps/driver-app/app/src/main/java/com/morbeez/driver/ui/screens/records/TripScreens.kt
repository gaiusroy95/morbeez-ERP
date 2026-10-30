package com.morbeez.driver.ui.screens.records

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.data.remote.dto.DriverTripCardResponse
import com.morbeez.driver.data.remote.dto.DriverTripSummaryResponse
import com.morbeez.driver.data.remote.dto.TripStopResponse
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.SegmentTabs
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.collect.methodLabel
import com.morbeez.driver.ui.screens.expenses.MiniStat
import com.morbeez.driver.ui.screens.expenses.categoryLabel
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.theme.Fresh
import java.math.BigDecimal

@Composable
fun tripStatusLabel(status: String): String = stringResource(
    when (status) {
        "planned" -> R.string.status_planned
        "in_progress" -> R.string.status_in_progress
        "completed" -> R.string.status_completed
        "on_hold" -> R.string.status_on_hold
        "reconciled" -> R.string.status_reconciled
        else -> R.string.status_cancelled
    },
)

@Composable
private fun TripStatusPill(status: String) = Pill(
    tripStatusLabel(status),
    when (status) {
        "reconciled" -> Tone.Good
        "completed", "on_hold" -> Tone.Attention
        "in_progress" -> Tone.Active
        else -> Tone.Neutral
    },
)

private fun placesLine(card: DriverTripCardResponse): String? =
    card.places.takeIf { it.isNotEmpty() }?.joinToString(" → ") ?: card.routeName

// ---------------------------------------------------------------------------
// Trip History (design sheet 4)
// ---------------------------------------------------------------------------

@Composable
fun TripHistoryScreen(onBack: () -> Unit, onOpen: (tripId: String) -> Unit, viewModel: TripHistoryViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    TripHistoryContent(state, onBack, onOpen, viewModel::load)
}

/** Trip History: the driver's trips in the dates chosen, each with what it did. Read from the server — not kept on the phone. */
@Composable
internal fun TripHistoryContent(state: HistoryUiState, onBack: () -> Unit, onOpen: (String) -> Unit, onRange: (HistoryRange) -> Unit) {
    FieldScreen(title = stringResource(R.string.drawer_trip_history), eyebrow = stringResource(R.string.hist_eyebrow), onBack = onBack) {
        SegmentTabs(
            listOf(
                HistoryRange.LAST_30_DAYS.name to stringResource(R.string.hist_last_30),
                HistoryRange.THIS_MONTH.name to stringResource(R.string.hist_this_month),
                HistoryRange.LAST_3_MONTHS.name to stringResource(R.string.hist_last_3_months),
            ),
            state.range.name,
            { onRange(HistoryRange.valueOf(it)) },
        )
        when {
            state.loading -> Text(stringResource(R.string.records_loading), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
            state.history == null -> {
                Callout(stringResource(R.string.records_need_signal), Tone.Attention, Glyph.Sync)
                SecondaryAction(stringResource(R.string.retry), { onRange(state.range) }, glyph = Glyph.Sync)
            }
            state.history.trips.isEmpty() -> Text(stringResource(R.string.hist_none), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
            else -> state.history.trips.forEach { TripCard(it) { onOpen(it.id) } }
        }
    }
}

@Composable
private fun TripCard(card: DriverTripCardResponse, onOpen: () -> Unit) {
    FieldCard(Modifier.clip(MaterialTheme.shapes.large).clickable(role = Role.Button, onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(card.number, style = MaterialTheme.typography.titleLarge, color = Fresh.primaryStrong, modifier = Modifier.weight(1f))
            TripStatusPill(card.status)
            Spacer(Modifier.width(6.dp))
            GlyphIcon(Glyph.ChevronRight, Fresh.inkFaint, size = 18.dp)
        }
        Text(listOfNotNull(RecordsFormat.date(card.day), placesLine(card)).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        Row(Modifier.fillMaxWidth().padding(top = 12.dp)) {
            MiniStat(stringResource(R.string.tab_procurement), stringResource(R.string.done_of, card.procurement.done, card.procurement.total), Modifier.weight(1f))
            MiniStat(stringResource(R.string.tab_delivery), stringResource(R.string.done_of, card.delivery.done, card.delivery.total), Modifier.weight(1f))
            MiniStat(stringResource(R.string.drawer_collections), stringResource(R.string.rupees, DayLogic.rupees(card.collected)), Modifier.weight(1.2f))
        }
        HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
        Row(Modifier.fillMaxWidth()) {
            MiniStat(stringResource(R.string.trip_km), card.km?.let { stringResource(R.string.km_value, DayLogic.quantity(it)) } ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.hist_duration), RecordsFormat.duration(card.minutes) ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.exp_fuel_used), stringResource(R.string.litres_value, DayLogic.quantity(card.fuelLitres)), Modifier.weight(1.2f))
        }
    }
}

// ---------------------------------------------------------------------------
// Trip Details (design sheet 4)
// ---------------------------------------------------------------------------

@Composable
fun TripDetailsScreen(onBack: () -> Unit, viewModel: TripDetailsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    TripDetailsContent(state, onBack, viewModel::load)
}

/** One trip in full: its summary, farms, deliveries, collections and backhaul. */
@Composable
internal fun TripDetailsContent(state: TripDetailsUiState, onBack: () -> Unit, onRetry: () -> Unit) {
    val s = state.summary
    var tab by rememberSaveable { mutableStateOf("summary") }
    FieldScreen(title = stringResource(R.string.trip_details), eyebrow = s?.card?.number, onBack = onBack) {
        if (s == null) {
            if (state.loading) {
                Text(stringResource(R.string.records_loading), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
            } else {
                Callout(stringResource(R.string.records_need_signal), Tone.Attention, Glyph.Sync)
                SecondaryAction(stringResource(R.string.retry), onRetry, glyph = Glyph.Sync)
            }
            return@FieldScreen
        }
        FieldCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.Pin, Fresh.primary, size = 22.dp)
                Spacer(Modifier.width(10.dp))
                Text(placesLine(s.card) ?: stringResource(R.string.no_route), style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                TripStatusPill(s.card.status)
            }
            Text(RecordsFormat.date(s.card.day) ?: "—", style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 4.dp))
        }
        SegmentTabs(
            listOf(
                "summary" to stringResource(R.string.trip_tab_summary),
                "procurement" to stringResource(R.string.tab_procurement),
                "delivery" to stringResource(R.string.tab_delivery),
                "collections" to stringResource(R.string.drawer_collections),
                "backhaul" to stringResource(R.string.drawer_backhaul),
            ),
            tab,
            { tab = it },
        )
        when (tab) {
            "procurement" -> StopList(s.stops.filter { it.stopType == "pickup" }) { FarmLines(it) }
            "delivery" -> StopList(s.stops.filter { it.stopType == "delivery" }) { DeliveryLines(it) }
            "collections" -> CollectionsTab(s)
            "backhaul" -> BackhaulTab(s)
            else -> SummaryTab(s)
        }
    }
}

@Composable
private fun SummaryTab(s: DriverTripSummaryResponse) {
    val c = s.card
    FieldCard {
        Row(Modifier.fillMaxWidth()) {
            MiniStat(stringResource(R.string.trip_start), RecordsFormat.clock(c.startedAt) ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.trip_end), RecordsFormat.clock(c.endedAt) ?: "—", Modifier.weight(1f))
        }
        HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 12.dp))
        Row(Modifier.fillMaxWidth()) {
            MiniStat(stringResource(R.string.trip_km), c.km?.let { stringResource(R.string.km_value, DayLogic.quantity(it)) } ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.hist_duration), RecordsFormat.duration(c.minutes) ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.exp_fuel_used), stringResource(R.string.litres_value, DayLogic.quantity(c.fuelLitres)), Modifier.weight(1f))
            MiniStat(stringResource(R.string.exp_avg_mileage), s.totals.kmPerLitre?.let { stringResource(R.string.kmpl_value, it) } ?: "—", Modifier.weight(1f))
        }
    }
    FieldCard {
        SummaryLine(stringResource(R.string.tab_procurement), stringResource(R.string.done_of, c.procurement.done, c.procurement.total))
        SummaryLine(stringResource(R.string.tab_delivery), stringResource(R.string.done_of, c.delivery.done, c.delivery.total))
        SummaryLine(stringResource(R.string.drawer_collections), stringResource(R.string.rupees, DayLogic.rupees(c.collected)))
        s.collections?.collected?.let { by ->
            listOf("cash" to by.cash, "upi" to by.upi, "bank_transfer" to by.bankTransfer, "cheque" to by.cheque)
                .filter { (_, v) -> (v.toBigDecimalOrNull() ?: BigDecimal.ZERO).signum() > 0 }
                .forEach { (m, v) -> SummaryLine("   ${methodLabel(m)}", stringResource(R.string.rupees, DayLogic.rupees(v)), minor = true) }
        }
        if (s.backhauls.any { it.status != "cancelled" }) SummaryLine(stringResource(R.string.drawer_backhaul), stringResource(R.string.rupees, DayLogic.rupees(c.backhaulReceived)))
        SummaryLine(stringResource(R.string.expenses), stringResource(R.string.rupees, DayLogic.rupees(s.totals.expenses)) + " · " + pluralStringResource(R.plurals.n_items, s.expenses.size, s.expenses.size))
        SummaryLine(stringResource(R.string.trip_fuel_cost), stringResource(R.string.rupees, DayLogic.rupees(s.totals.fuel)))
        SummaryLine(stringResource(R.string.trip_tolls), stringResource(R.string.rupees, DayLogic.rupees(s.totals.tolls)))
    }
    FieldCard {
        Eyebrow(stringResource(R.string.trip_vehicle_km))
        Text(listOfNotNull(s.vehicle.registrationNumber, s.vehicle.makeModel).joinToString(" · "), style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.padding(top = 6.dp))
        Row(Modifier.fillMaxWidth().padding(top = 10.dp)) {
            MiniStat(stringResource(R.string.opening_km), s.trip.openingKm?.let { DayLogic.quantity(it) } ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.closing_km), s.trip.closingKm?.let { DayLogic.quantity(it) } ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.trip_km), c.km?.let { DayLogic.quantity(it) } ?: "—", Modifier.weight(1f))
        }
    }
    // What the driver earned on it (D7): kept at the owner's close, else an estimate.
    s.incentives?.takeIf { it.lines.isNotEmpty() }?.let { inc ->
        FieldCard {
            Eyebrow(stringResource(if (inc.final) R.string.trip_your_incentives else R.string.trip_your_incentives_estimate))
            inc.lines.filter { (it.amount.toBigDecimalOrNull()?.signum() ?: 0) > 0 }.forEach { l ->
                Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text(com.morbeez.driver.ui.screens.earnings.incentiveTitle(l.kind), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                    Text(stringResource(R.string.rupees, DayLogic.rupees(l.amount)), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink)
                }
            }
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 8.dp))
            SummaryLine(stringResource(R.string.earn_total), stringResource(R.string.rupees, DayLogic.rupees(inc.total)))
        }
    }
    if (s.expenses.isNotEmpty()) {
        FieldCard {
            Eyebrow(stringResource(R.string.expenses))
            s.expenses.forEach { e ->
                Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text(categoryLabel(e.category) + (e.notes?.let { " · $it" } ?: ""), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                    Text(stringResource(R.string.rupees, DayLogic.rupees(e.amount)), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink)
                }
            }
        }
    }
    val closed = s.closed
    when {
        closed != null -> Callout(
            stringResource(R.string.trip_closed_by, RecordsLogic.phone(closed.by) ?: "—", RecordsFormat.date(closed.at) ?: "—"),
            Tone.Good,
            Glyph.Check,
        )
        s.trip.status == "completed" -> Callout(stringResource(R.string.trip_waiting_close), Tone.Active, Glyph.Clock)
        s.trip.status == "on_hold" -> Callout(stringResource(R.string.on_hold_callout, s.trip.reviewNote ?: stringResource(R.string.checking_it)), Tone.Attention)
        else -> Unit
    }
}

@Composable
private fun SummaryLine(label: String, value: String, minor: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = if (minor) 2.dp else 6.dp)) {
        Text(label, style = if (minor) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyLarge, color = if (minor) Fresh.inkMuted else Fresh.ink, modifier = Modifier.weight(1f))
        Text(value, style = if (minor) MaterialTheme.typography.bodySmall else MaterialTheme.typography.titleSmall, color = Fresh.ink)
    }
}

@Composable
private fun StopList(stops: List<TripStopResponse>, lines: @Composable (TripStopResponse) -> Unit) {
    if (stops.isEmpty()) {
        Text(stringResource(R.string.no_stops_here), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        return
    }
    stops.forEach { stop ->
        FieldCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(30.dp).clip(RoundedCornerShape(10.dp)).background(Fresh.surface2), contentAlignment = Alignment.Center) {
                    Text("${stop.sequenceNumber}", style = MaterialTheme.typography.labelLarge, color = Fresh.primary)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(stop.party?.name ?: "—", style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                    stop.party?.place?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted) }
                }
                when (stop.status) {
                    "completed" -> Pill(stringResource(R.string.pill_completed), Tone.Good)
                    "skipped" -> Pill(stringResource(R.string.pill_skipped), Tone.Attention)
                    else -> Pill(stringResource(R.string.pill_to_do), Tone.Neutral)
                }
            }
            lines(stop)
        }
    }
}

@Composable
private fun FarmLines(stop: TripStopResponse) {
    val farm = stop.farm
    if (farm == null) {
        stop.items.forEach { Text("${it.productName} · ${DayLogic.quantity(it.quantity)} ${it.uom}", style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 6.dp)) }
        return
    }
    farm.lines.forEach { l ->
        val text = if (l.outcome == "accepted") {
            stringResource(R.string.trip_line_accepted, l.productName, DayLogic.quantity(l.acceptedQuantity), l.uom)
        } else {
            stringResource(R.string.trip_line_rejected, l.productName, l.reason ?: "—")
        }
        Text(text, style = MaterialTheme.typography.bodySmall, color = if (l.outcome == "accepted") Fresh.ink else Fresh.warning, modifier = Modifier.padding(top = 6.dp))
    }
    Text(stringResource(R.string.kg_value, DayLogic.quantity(farm.loadedKg)), style = MaterialTheme.typography.labelLarge, color = Fresh.primaryStrong, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun DeliveryLines(stop: TripStopResponse) {
    stop.items.forEach { Text("${it.productName} · ${DayLogic.quantity(it.quantity)} ${it.uom}", style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 6.dp)) }
    stop.delivery?.shortfalls.orEmpty().forEach { sf ->
        Text(stringResource(R.string.trip_line_short, sf.productName, sf.reason), style = MaterialTheme.typography.bodySmall, color = Fresh.warning, modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun CollectionsTab(s: DriverTripSummaryResponse) {
    val c = s.collections
    if (c == null || c.customers.isEmpty()) {
        Text(stringResource(R.string.trip_no_collections), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        return
    }
    FieldCard {
        c.customers.forEachIndexed { i, cust ->
            if (i > 0) HorizontalDivider(color = Fresh.border)
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(cust.name, style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
                    Text(stringResource(R.string.trip_outstanding_now, DayLogic.rupees(cust.outstanding)), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                }
                Text(stringResource(R.string.rupees, DayLogic.rupees(cust.collectedOnTrip)), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), color = Fresh.primaryStrong)
            }
        }
        HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 6.dp))
        SummaryLine(stringResource(R.string.total_collected), stringResource(R.string.rupees, DayLogic.rupees(c.collected.total)))
    }
}

@Composable
private fun BackhaulTab(s: DriverTripSummaryResponse) {
    if (s.backhauls.isEmpty()) {
        Text(stringResource(R.string.trip_no_backhaul), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        return
    }
    s.backhauls.forEach { b ->
        FieldCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${b.pickupPlace} → ${b.dropPlace}", style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                when {
                    b.payment != null -> Pill(stringResource(R.string.pill_paid), Tone.Good)
                    b.status == "skipped" -> Pill(stringResource(R.string.pill_skipped), Tone.Attention)
                    b.status == "cancelled" -> Pill(stringResource(R.string.pill_cancelled), Tone.Neutral)
                    else -> Pill(stringResource(R.string.pill_to_pay), Tone.Attention)
                }
            }
            Text(stringResource(R.string.trip_backhaul_rent, DayLogic.rupees(b.rent)), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(top = 4.dp))
            b.payment?.let { p ->
                Text(stringResource(R.string.trip_backhaul_received, DayLogic.rupees(p.amount), methodLabel(p.method)), style = MaterialTheme.typography.bodyMedium, color = Fresh.primaryStrong, modifier = Modifier.padding(top = 4.dp))
            }
            b.skipReason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Fresh.warning, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
}
