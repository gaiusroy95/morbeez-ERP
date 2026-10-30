package com.morbeez.driver.ui.screens.collect

import android.content.Context
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.R
import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.data.remote.dto.HandoverResponse
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.HoldToConfirm
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.backhaul.BackhaulLogic
import com.morbeez.driver.ui.screens.deliver.DeliveryLogic
import com.morbeez.driver.ui.screens.deliver.leftOnVehicle
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.KmProblem
import com.morbeez.driver.ui.theme.Fresh
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.math.BigDecimal
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** The end of the trip, as this phone has it: collections, stops, what's on the vehicle, the server's handover figures. */
data class EndOfTripUiState(
    val collections: CollectionsUiState = CollectionsUiState(),
    val handover: HandoverResponse? = null,
    val checkingHandover: Boolean = false,
    /** Kilos still on the vehicle, by the phone's reckoning. */
    val leftKg: BigDecimal = BigDecimal.ZERO,
    val cratesLeft: Int = 0,
    val cratesBack: Int = 0,
    /** Done on this phone, not sent yet: the server's figures don't include them. */
    val unsent: Int = 0,
    /** The trip's backhauls (D5). */
    val backhauls: List<BackhaulEntity> = emptyList(),
) {
    val trip get() = collections.trip
    val stops get() = collections.stops
    val stopsLeft get() = stops.count { it.status == "pending" }
    /** A trip that set off with an opening KM needs its closing one before the handover. */
    val needsReturn get() = trip?.openingKm != null && trip?.closingKm == null
    val tripKm get() = CollectionsLogic.tripKm(trip?.openingKm, trip?.closingKm)
    /** A backhaul waiting for an answer or under way: the vehicle isn't back. */
    val backhaulHoldsReturn get() = BackhaulLogic.holdsReturn(backhauls)
    /** …or done but not paid: no handover yet. */
    val backhaulHoldsHandover get() = BackhaulLogic.holdsHandover(backhauls)
}

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@HiltViewModel
class EndOfTripViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
) : ViewModel() {
    private val handover = MutableStateFlow<HandoverResponse?>(null)
    private val checking = MutableStateFlow(false)

    private val backhauls = trips.observeActiveTrip().flatMapLatest { t -> t?.let { trips.observeBackhauls(it.id) } ?: flowOf(emptyList()) }
    private val collectionsAndBackhauls = combine(collectionsOf(trips), backhauls) { c, b -> c to b }

    val state: StateFlow<EndOfTripUiState> = combine(collectionsAndBackhauls, trips.observeDay(), trips.observePendingCount(), handover, checking) { (c, backhaulList), day, unsent, h, busy ->
        val farms = c.stops.mapNotNull { s -> trips.farmOf(s)?.let { s.id to it } }.toMap()
        val deliveries = c.stops.mapNotNull { s -> trips.deliveryOf(s)?.let { s.id to it } }.toMap()
        val stock = DeliveryLogic.stockOf(trips.stockOf(day), c.stops, farms, deliveries) { trips.itemsOf(it) }
        EndOfTripUiState(
            collections = c,
            handover = h,
            checkingHandover = busy,
            leftKg = leftOnVehicle(stock),
            cratesLeft = deliveries.values.sumOf { it.crates.dropped },
            cratesBack = deliveries.values.sumOf { it.crates.collected },
            unsent = unsent,
            backhauls = backhaulList,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), EndOfTripUiState())

    /** The server's handover figures — online only; queued actions go first. */
    fun checkHandover() {
        val tripId = state.value.trip?.id ?: return
        checking.value = true
        SyncWorker.requestNow(appContext)
        viewModelScope.launch {
            handover.value = trips.getHandover(tripId) ?: handover.value
            checking.value = false
        }
    }

    /** Return: the closing KM, on the phone at once. */
    fun returnTrip(closingKm: Double, onDone: () -> Unit) {
        val tripId = state.value.trip?.id ?: return
        viewModelScope.launch {
            trips.queueReturn(tripId, closingKm)
            SyncWorker.requestNow(appContext)
            onDone()
        }
    }

    /** Hand over the cash and submit the trip: the owner checks it and closes it. */
    fun handOver(cashDeclared: Double?, note: String?, onDone: () -> Unit) {
        val tripId = state.value.trip?.id ?: return
        viewModelScope.launch {
            trips.queueSubmitTrip(tripId, cashDeclared, note?.trim()?.ifBlank { null })
            SyncWorker.requestNow(appContext)
            onDone()
        }
    }
}

private fun km(text: String?) = text?.let { DayLogic.quantity(it) } ?: "—"

// ---------------------------------------------------------------------------
// Return & closing KM (design sheet screen 18)
// ---------------------------------------------------------------------------

@Composable
fun ReturnScreen(onBack: () -> Unit, onDone: () -> Unit, onBackhaul: () -> Unit = {}, viewModel: EndOfTripViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ReturnContent(state, onBack, onBackhaul = onBackhaul) { viewModel.returnTrip(it, onDone) }
}

/** Return (client spec §22): the odometer back at base — never below the opening KM; trip KM = closing − opening. */
@Composable
internal fun ReturnContent(state: EndOfTripUiState, onBack: () -> Unit, onBackhaul: () -> Unit = {}, onConfirm: (Double) -> Unit) {
    val trip = state.trip
    var closing by rememberSaveable { mutableStateOf(trip?.closingKm?.let { DayLogic.quantity(it).replace(",", "") }.orEmpty()) }
    val opening = trip?.openingKm?.toDoubleOrNull()
    val problem = DayLogic.openingKmProblem(closing, opening)
    val tripKm = CollectionsLogic.tripKm(trip?.openingKm, closing.trim().takeIf { problem == null })
    val (pendingCount, pendingAmount) = state.collections.pending
    FieldScreen(
        title = stringResource(R.string.return_to_base),
        eyebrow = trip?.number,
        onBack = onBack,
        bottomBar = {
            if (state.backhaulHoldsReturn) PrimaryAction(stringResource(R.string.drawer_backhaul), onBackhaul, glyph = Glyph.Truck)
            else PrimaryAction(stringResource(R.string.confirm_km), { closing.trim().toDoubleOrNull()?.let(onConfirm) }, enabled = trip != null && problem == null, glyph = Glyph.Check)
        },
    ) {
        if (state.stopsLeft > 0) Callout(stringResource(R.string.finish_stops_first, state.stopsLeft), Tone.Attention)
        if (state.backhaulHoldsReturn) Callout(stringResource(R.string.backhaul_before_return), Tone.Attention, Glyph.Truck)
        if (pendingCount > 0) Callout(stringResource(R.string.collect_before_return, pendingCount, DayLogic.rupees(pendingAmount.toPlainString())), Tone.Active, Glyph.Rupee)
        FieldCard {
            KmRow(stringResource(R.string.opening_km), stringResource(R.string.km_value, km(trip?.openingKm)))
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 12.dp))
            FreshTextField(closing, { closing = it.filter { c -> c.isDigit() || c == '.' }.take(10) }, stringResource(R.string.closing_km), keyboardType = KeyboardType.Decimal, leading = Glyph.Gauge)
            if (problem != null && closing.isNotBlank()) {
                Text(
                    when (problem) {
                        KmProblem.BELOW_LAST -> stringResource(R.string.closing_below_opening, km(trip?.openingKm))
                        KmProblem.ONE_DECIMAL -> stringResource(R.string.km_one_decimal)
                        else -> stringResource(R.string.km_not_number)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = Fresh.critical,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 12.dp))
            KmRow(stringResource(R.string.trip_km), tripKm?.let { stringResource(R.string.km_value, DayLogic.quantity(it.toPlainString())) } ?: "—", strong = true)
        }
    }
}

@Composable
private fun KmRow(label: String, value: String, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
        Text(value, style = if (strong) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium, color = if (strong) Fresh.primary else Fresh.ink)
    }
}

// ---------------------------------------------------------------------------
// Cash handover (design sheet screen 19)
// ---------------------------------------------------------------------------

@Composable
fun HandoverScreen(onBack: () -> Unit, onReturn: () -> Unit, onDone: () -> Unit, onBackhaul: () -> Unit = {}, viewModel: EndOfTripViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.checkHandover() }
    HandoverContent(state, onBack, onReturn, onRefresh = viewModel::checkHandover, onBackhaul = onBackhaul) { cash, note -> viewModel.handOver(cash, note, onDone) }
}

/**
 * Cash handover (client spec §23): what the driver should hand over —
 * opening cash + cash collected + spot-sale cash + backhaul rent in cash −
 * expenses − bank deposits;
 * UPI and transfers never count — and what they actually hand over. A
 * difference goes to the owner with a note; nothing is deducted here.
 */
@Composable
internal fun HandoverContent(
    state: EndOfTripUiState,
    onBack: () -> Unit,
    onReturn: () -> Unit,
    onRefresh: () -> Unit,
    onBackhaul: () -> Unit = {},
    onHandOver: (Double?, String?) -> Unit,
) {
    val h = state.handover
    var cash by rememberSaveable(h?.expected) { mutableStateOf(h?.expected?.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString().orEmpty()) }
    var note by rememberSaveable { mutableStateOf("") }
    val typed = cash.trim().toBigDecimalOrNull()?.takeIf { it.signum() >= 0 && it.stripTrailingZeros().scale() <= 2 }
    val expected = h?.expected?.toBigDecimalOrNull()
    val diff = if (typed != null && expected != null) typed - expected else null
    val blocked = state.stopsLeft > 0 || state.needsReturn || state.backhaulHoldsHandover || state.trip?.status != "in_progress"
    val ready = !blocked && typed != null && (diff == null || diff.signum() == 0 || note.trim().length >= 3)
    FieldScreen(
        title = stringResource(R.string.cash_handover),
        eyebrow = state.trip?.number,
        onBack = onBack,
        bottomBar = {
            if (state.backhaulHoldsHandover) PrimaryAction(stringResource(R.string.drawer_backhaul), onBackhaul, glyph = Glyph.Truck)
            else if (state.needsReturn) PrimaryAction(stringResource(R.string.return_to_base), onReturn, glyph = Glyph.Truck)
            else HoldToConfirm(stringResource(R.string.hold_to_hand_over), { onHandOver(typed?.toDouble(), note) }, enabled = ready)
        },
    ) {
        when {
            state.stopsLeft > 0 -> Callout(stringResource(R.string.finish_stops_first, state.stopsLeft), Tone.Attention)
            state.backhaulHoldsHandover -> Callout(stringResource(R.string.backhaul_before_handover), Tone.Attention, Glyph.Truck)
            state.needsReturn -> Callout(stringResource(R.string.return_first), Tone.Attention, Glyph.Gauge)
        }
        if (h == null) {
            Callout(stringResource(if (state.checkingHandover) R.string.checking_handover else R.string.offline_total), Tone.Active, Glyph.Sync)
        } else {
            FieldCard {
                MoneyRow(stringResource(R.string.opening_cash), h.openingCash)
                MoneyRow(stringResource(R.string.plus_cash_collected), h.cashCollections)
                if ((h.spotCash.toBigDecimalOrNull() ?: BigDecimal.ZERO).signum() > 0) MoneyRow(stringResource(R.string.plus_spot_cash), h.spotCash)
                if ((h.backhaulCash?.toBigDecimalOrNull() ?: BigDecimal.ZERO).signum() > 0) MoneyRow(stringResource(R.string.plus_backhaul_cash), h.backhaulCash.orEmpty())
                MoneyRow(stringResource(R.string.minus_expenses), h.expenses, minus = true)
                if ((h.deposited.toBigDecimalOrNull() ?: BigDecimal.ZERO).signum() > 0) MoneyRow(stringResource(R.string.minus_deposited), h.deposited, minus = true)
                HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.expected_cash), style = MaterialTheme.typography.titleLarge, color = Fresh.ink, modifier = Modifier.weight(1f))
                    Text(stringResource(R.string.rupees, DayLogic.rupees(h.expected)), style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold), color = Fresh.primary)
                }
            }
            if ((h.directPayments.toBigDecimalOrNull() ?: BigDecimal.ZERO).signum() > 0) {
                Callout(stringResource(R.string.direct_payments_note, DayLogic.rupees(h.directPayments)), Tone.Active, Glyph.Check)
            }
            if (state.unsent > 0) Callout(stringResource(R.string.handover_unsent), Tone.Attention, Glyph.Sync)
        }
        FreshTextField(cash, { cash = it.filter { c -> c.isDigit() || c == '.' }.take(10) }, stringResource(R.string.actual_cash), keyboardType = KeyboardType.Decimal, prefix = "₹")
        if (diff != null && diff.signum() != 0) {
            Text(
                stringResource(if (diff.signum() < 0) R.string.less_than_expected else R.string.more_than_expected, DayLogic.rupees(diff.abs().toPlainString())),
                style = MaterialTheme.typography.bodyMedium,
                color = Fresh.warning,
            )
            FreshTextField(note, { note = it.take(300) }, stringResource(R.string.note_for_owner), singleLine = false)
        }
        if (h == null && !state.checkingHandover) Box(Modifier.fillMaxWidth()) { com.morbeez.driver.ui.components.SecondaryAction(stringResource(R.string.retry), onRefresh, glyph = Glyph.Sync) }
    }
}

@Composable
private fun MoneyRow(label: String, amount: String, minus: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = Fresh.ink, modifier = Modifier.weight(1f))
        Text((if (minus) "− " else "") + stringResource(R.string.rupees, DayLogic.rupees(amount)), style = MaterialTheme.typography.bodyLarge, color = if (minus) Fresh.critical else Fresh.ink)
    }
}

// ---------------------------------------------------------------------------
// Trip summary (design sheet screen 21)
// ---------------------------------------------------------------------------

@Composable
fun TripSummaryScreen(onBack: () -> Unit, viewModel: EndOfTripViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    TripSummaryContent(state, onBack)
}

/** The trip at a glance once it's handed over (or before): every check the owner makes when closing it. */
@Composable
internal fun TripSummaryContent(state: EndOfTripUiState, onBack: () -> Unit) {
    val trip = state.trip
    val stops = state.stops
    val pick = DayLogic.progressOf(stops, "pickup")
    val drop = DayLogic.progressOf(stops, "delivery")
    val (pendingCount, _) = state.collections.pending
    FieldScreen(title = stringResource(R.string.summary_title), eyebrow = trip?.number, onBack = onBack) {
        when (trip?.status) {
            "completed" -> Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Fresh.primaryTint).padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(Fresh.primary), contentAlignment = Alignment.Center) { GlyphIcon(Glyph.Check, Color.White, size = 28.dp) }
                Text(stringResource(R.string.trip_handed_over), style = MaterialTheme.typography.headlineSmall, color = Fresh.primaryStrong, modifier = Modifier.padding(top = 12.dp))
                Text(
                    trip.cashDeclared?.let { stringResource(R.string.submitted_callout_cash, DayLogic.rupees(it)) } ?: stringResource(R.string.submitted_callout),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.ink,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            "on_hold" -> Callout(stringResource(R.string.on_hold_callout, trip.reviewNote ?: stringResource(R.string.checking_it)), Tone.Attention)
            else -> Unit
        }
        FieldCard {
            SummaryRow(stringResource(R.string.tab_procurement), stringResource(R.string.done_of, pick.done, pick.total), pick.done == pick.total)
            SummaryRow(stringResource(R.string.tab_delivery), stringResource(R.string.done_of, drop.done, drop.total), drop.done == drop.total)
            SummaryRow(stringResource(R.string.tile_stock), stringResource(R.string.kg_value, DayLogic.quantity(state.leftKg.toPlainString())), state.leftKg.signum() == 0)
            SummaryRow(stringResource(R.string.crates), stringResource(R.string.crates_short, state.cratesLeft, state.cratesBack), true)
            SummaryRow(stringResource(R.string.drawer_collections), stringResource(R.string.rupees, DayLogic.rupees(state.collections.collected.total.toPlainString())), pendingCount == 0)
            val backhauls = state.backhauls.filter { it.status != "cancelled" }
            if (backhauls.isNotEmpty()) {
                val received = backhauls.mapNotNull { it.amountReceived?.toBigDecimalOrNull() }.fold(BigDecimal.ZERO, BigDecimal::add)
                SummaryRow(
                    stringResource(R.string.drawer_backhaul),
                    if (backhauls.all { it.status == "skipped" }) stringResource(R.string.pill_skipped) else stringResource(R.string.rupees, DayLogic.rupees(received.toPlainString())),
                    !state.backhaulHoldsHandover,
                )
            }
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 8.dp))
            SummaryRow(stringResource(R.string.opening_km), stringResource(R.string.km_value, km(trip?.openingKm)), trip?.openingKm != null)
            SummaryRow(stringResource(R.string.closing_km), stringResource(R.string.km_value, km(trip?.closingKm)), trip?.closingKm != null)
            SummaryRow(stringResource(R.string.trip_km), state.tripKm?.let { stringResource(R.string.km_value, DayLogic.quantity(it.toPlainString())) } ?: "—", state.tripKm != null)
            trip?.cashDeclared?.let { SummaryRow(stringResource(R.string.cash_declared), stringResource(R.string.rupees, DayLogic.rupees(it)), true) }
        }
    }
}

@Composable
private fun SummaryRow(label: String, value: String, ok: Boolean) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(22.dp).clip(CircleShape).background(if (ok) Fresh.primary else Fresh.warningTint), contentAlignment = Alignment.Center) {
            if (ok) GlyphIcon(Glyph.Check, Color.White, size = 13.dp) else Text("!", style = MaterialTheme.typography.labelMedium, color = Fresh.warning)
        }
        Spacer(Modifier.width(12.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = Fresh.ink, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
    }
}
