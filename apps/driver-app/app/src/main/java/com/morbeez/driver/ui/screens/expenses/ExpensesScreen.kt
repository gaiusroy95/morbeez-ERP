package com.morbeez.driver.ui.screens.expenses

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.data.remote.dto.VehicleMileageResponse
import com.morbeez.driver.data.repository.FuelDetails
import com.morbeez.driver.data.repository.NewExpense
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.PhotoCaptureButton
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.SegmentTabs
import com.morbeez.driver.ui.components.Stat
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.records.RecordsFormat
import com.morbeez.driver.ui.theme.Fresh
import java.math.BigDecimal

private val cameraPhoto: PhotoSlot = { label, captured, onCaptured -> PhotoCaptureButton(label = label, onCaptured = onCaptured, captured = captured) }

@Composable
fun categoryLabel(category: String?): String = stringResource(
    when (category) {
        "fuel" -> R.string.cat_fuel
        "toll" -> R.string.cat_toll
        "parking" -> R.string.cat_parking
        "labour" -> R.string.cat_labour
        "repair" -> R.string.cat_repair
        else -> R.string.cat_other
    },
)

fun categoryGlyph(category: String?): Glyph = when (category) {
    "fuel" -> Glyph.Fuel
    "toll" -> Glyph.Tower
    "parking" -> Glyph.Parking
    "labour" -> Glyph.Box
    "repair" -> Glyph.Wrench
    else -> Glyph.Dots
}

@Composable
fun fuelTypeLabel(type: String?): String = stringResource(
    when (type) {
        "petrol" -> R.string.fuel_petrol
        "cng" -> R.string.fuel_cng
        "electric" -> R.string.fuel_electric
        else -> R.string.fuel_diesel
    },
)

// ---------------------------------------------------------------------------
// My Expenses (design sheet 3)
// ---------------------------------------------------------------------------

@Composable
fun MyExpensesScreen(onBack: () -> Unit, onNew: () -> Unit, viewModel: ExpensesViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    MyExpensesContent(state, onBack, onNew, onDeposit = viewModel::recordDeposit)
}

/**
 * My Expenses: this trip's, or the last 30 days' across trips — each with
 * where it stands with the owner — and the vehicle's mileage, worked out
 * from full tank to full tank.
 */
@Composable
internal fun MyExpensesContent(
    state: ExpensesUiState,
    onBack: () -> Unit,
    onNew: () -> Unit,
    onDeposit: (amount: Double, bankAccount: String, reference: String) -> Unit = { _, _, _ -> },
) {
    var tab by rememberSaveable { mutableStateOf(if (state.trip != null) "trip" else "all") }
    val rows = if (tab == "trip" && state.trip != null) state.thisTrip else state.allTrips
    val totals = ExpenseLogic.totalsOf(rows)
    val level = state.trip?.authorityLevel
    FieldScreen(
        title = stringResource(R.string.exp_my_title),
        eyebrow = state.trip?.number?.let { stringResource(R.string.trip_number, it) },
        onBack = onBack,
        headerExtra = {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Stat(stringResource(R.string.exp_total), stringResource(R.string.rupees, rupees(totals.all)), onDark = true, modifier = Modifier.weight(1.3f))
                Stat(stringResource(R.string.cat_fuel), stringResource(R.string.rupees, rupees(totals.fuel)), onDark = true, modifier = Modifier.weight(1f))
                Stat(stringResource(R.string.cat_other), stringResource(R.string.rupees, rupees(totals.other)), onDark = true, modifier = Modifier.weight(1f))
            }
        },
        bottomBar = if (state.canRecord) {
            { PrimaryAction(stringResource(R.string.exp_new), onNew, glyph = Glyph.Plus) }
        } else {
            null
        },
    ) {
        if (state.trip != null) {
            SegmentTabs(listOf("trip" to stringResource(R.string.exp_this_trip), "all" to stringResource(R.string.exp_all_trips)), tab, { tab = it })
        }
        if (state.canRecord && level != null && level in 1..3) Callout(stringResource(R.string.exp_owner_approves), Tone.Active)
        if (rows.isEmpty()) {
            Text(
                stringResource(if (tab == "trip" && state.trip != null) R.string.exp_none_trip else R.string.exp_none_all),
                style = MaterialTheme.typography.bodyMedium,
                color = Fresh.inkMuted,
            )
        }
        rows.groupBy { RecordsFormat.date(it.recordedAt) }.forEach { (day, dayRows) ->
            Eyebrow(day ?: "—", modifier = Modifier.padding(top = 4.dp))
            FieldCard {
                dayRows.forEachIndexed { i, row ->
                    if (i > 0) HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
                    ExpenseLine(row, showTrip = tab == "all")
                }
            }
        }
        MileageCard(state.recent?.mileage)
        val trip = state.trip
        if (tab == "trip" && trip?.status == "in_progress" && (level == null || level >= 2)) DepositCard(onDeposit)
    }
}

private fun rupees(b: BigDecimal) = DayLogic.rupees(b.toPlainString())

@Composable
private fun ExpenseLine(row: ExpenseRow, showTrip: Boolean) {
    Row(verticalAlignment = Alignment.Top) {
        Text(RecordsFormat.clock(row.recordedAt) ?: "", style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.width(64.dp).padding(top = 2.dp))
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(Fresh.surface2), contentAlignment = Alignment.Center) {
            GlyphIcon(categoryGlyph(row.category), Fresh.primary, size = 18.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(categoryLabel(row.category), style = MaterialTheme.typography.titleSmall, color = Fresh.ink, modifier = Modifier.weight(1f))
                Text(stringResource(R.string.rupees, DayLogic.rupees(row.amount)), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold), color = Fresh.ink)
            }
            if (row.litres != null && row.ratePerLitre != null) {
                Text(
                    stringResource(R.string.exp_fuel_line, fuelTypeLabel(row.fuelType), DayLogic.quantity(row.litres), DayLogic.rupees(row.ratePerLitre)),
                    style = MaterialTheme.typography.bodySmall,
                    color = Fresh.inkMuted,
                )
            }
            row.odometerKm?.let { km ->
                Text(
                    stringResource(if (row.fullTank == false) R.string.exp_part_fill_at else R.string.exp_full_tank_at, DayLogic.quantity("$km")),
                    style = MaterialTheme.typography.bodySmall,
                    color = Fresh.inkMuted,
                )
            }
            row.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted) }
            val extras = listOfNotNull(
                row.tripNumber?.takeIf { showTrip }?.let { stringResource(R.string.trip_number, it) },
                row.photos.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.n_photos, it, it) },
            )
            if (extras.isNotEmpty()) Text(extras.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint)
            StandingPill(row.standing, row.decisionNote)
        }
    }
}

@Composable
private fun StandingPill(standing: Standing, note: String?) {
    val pill: Pair<String, Tone>? = when (standing) {
        Standing.UNSENT -> stringResource(R.string.exp_unsent) to Tone.Neutral
        Standing.WAITING -> stringResource(R.string.exp_waiting) to Tone.Attention
        Standing.APPROVED -> stringResource(R.string.exp_approved) to Tone.Good
        Standing.REJECTED -> stringResource(R.string.exp_rejected) to Tone.Bad
        Standing.RECORDED -> null
    }
    if (pill != null) Box(Modifier.padding(top = 6.dp)) { Pill(pill.first, pill.second) }
    if (standing == Standing.REJECTED && note != null) {
        Text(stringResource(R.string.owner_said, note), style = MaterialTheme.typography.bodySmall, color = Fresh.critical, modifier = Modifier.padding(top = 4.dp))
    }
}

/** Vehicle mileage, worked out from full tank to full tank (design sheet 3). */
@Composable
private fun MileageCard(m: VehicleMileageResponse?) {
    if (m == null) return
    FieldCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlyphIcon(Glyph.Gauge, Fresh.primary, size = 20.dp)
            Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.exp_mileage_title, m.registrationNumber), style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
        }
        val last = m.last
        if (last == null) {
            Text(stringResource(R.string.exp_mileage_none), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(top = 10.dp))
        } else {
            Row(Modifier.fillMaxWidth().padding(top = 12.dp)) {
                MiniStat(stringResource(R.string.exp_last_full), stringResource(R.string.km_value, DayLogic.quantity("${last.fromKm}")), Modifier.weight(1f))
                MiniStat(stringResource(R.string.exp_current_full), stringResource(R.string.km_value, DayLogic.quantity("${last.toKm}")), Modifier.weight(1f))
                MiniStat(stringResource(R.string.exp_distance), stringResource(R.string.km_value, DayLogic.quantity("${last.km}")), Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp)) {
                MiniStat(stringResource(R.string.exp_fuel_used), stringResource(R.string.litres_value, DayLogic.quantity(last.litres)), Modifier.weight(1f))
                MiniStat(stringResource(R.string.exp_mileage), last.kmPerLitre?.let { stringResource(R.string.kmpl_value, it) } ?: "—", Modifier.weight(1f))
                MiniStat(stringResource(R.string.exp_avg_mileage), m.averageKmPerLitre?.let { stringResource(R.string.kmpl_value, it) } ?: "—", Modifier.weight(1f))
            }
        }
        Text(stringResource(R.string.exp_mileage_note), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint, modifier = Modifier.padding(top = 10.dp))
    }
}

@Composable
fun MiniStat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
        Text(value, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold), color = Fresh.ink, modifier = Modifier.padding(top = 2.dp))
    }
}

/** Cash paid into the bank on the road (handover case C): it no longer has to be handed over. */
@Composable
private fun DepositCard(onDeposit: (Double, String, String) -> Unit) {
    var amountText by rememberSaveable { mutableStateOf("") }
    var account by rememberSaveable { mutableStateOf("") }
    var reference by rememberSaveable { mutableStateOf("") }
    var saved by rememberSaveable { mutableStateOf(false) }
    val amount = ExpenseLogic.positive(amountText, 2)
    FieldCard {
        Eyebrow(stringResource(R.string.deposit_title), modifier = Modifier.padding(bottom = 6.dp))
        Text(stringResource(R.string.deposit_hint), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(bottom = 10.dp))
        FreshTextField(amountText, { amountText = it; saved = false }, stringResource(R.string.amount_rupees), keyboardType = KeyboardType.Decimal, leading = Glyph.Rupee)
        FreshTextField(account, { account = it }, stringResource(R.string.bank_account), modifier = Modifier.padding(top = 10.dp))
        FreshTextField(reference, { reference = it }, stringResource(R.string.slip_reference), modifier = Modifier.padding(top = 10.dp))
        if (saved) Box(Modifier.padding(top = 10.dp)) { Callout(stringResource(R.string.deposit_recorded), tone = Tone.Good, glyph = Glyph.Check) }
        SecondaryAction(
            text = stringResource(R.string.record_deposit),
            onClick = {
                onDeposit(amount?.toDouble() ?: 0.0, account.trim(), reference.trim())
                amountText = ""
                reference = ""
                saved = true
            },
            enabled = amount != null && account.isNotBlank() && reference.isNotBlank(),
            glyph = Glyph.Check,
            modifier = Modifier.padding(top = 14.dp),
        )
    }
}

// ---------------------------------------------------------------------------
// New Expense (design sheet 3)
// ---------------------------------------------------------------------------

@Composable
fun NewExpenseScreen(onBack: () -> Unit, onDone: () -> Unit, viewModel: ExpensesViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    NewExpenseContent(state, onBack, cameraPhoto) { expense, bill -> viewModel.save(expense, bill, onDone) }
}

/** What New Expense starts with: empty, but for the screenshot tests' samples. */
data class ExpenseForm(
    val category: String = "fuel",
    val amount: String = "",
    val odometer: String = "",
    val fuelType: String? = null,
    val fullTank: Boolean = true,
    val litres: String = "",
    val rate: String = "",
    val notes: String = "",
    val billPath: String? = null,
)

/**
 * New Expense: the category; for fuel the pump's details — odometer, fuel
 * type, full tank or not, litres and the rate, the total worked out — and
 * for the rest the amount; the bill photographed; a note.
 */
@Composable
internal fun NewExpenseContent(
    state: ExpensesUiState,
    onBack: () -> Unit,
    photo: PhotoSlot,
    initial: ExpenseForm = ExpenseForm(),
    onSave: (NewExpense, bill: Pair<String, String>?) -> Unit,
) {
    val trip = state.trip
    var category by rememberSaveable { mutableStateOf(initial.category) }
    var amountText by rememberSaveable { mutableStateOf(initial.amount) }
    var odometerText by rememberSaveable { mutableStateOf(initial.odometer) }
    var fuelType by rememberSaveable { mutableStateOf(initial.fuelType ?: state.vehicleFuelType?.takeIf { it in ExpenseLogic.FUEL_TYPES } ?: "diesel") }
    var fullTank by rememberSaveable { mutableStateOf(initial.fullTank) }
    var litresText by rememberSaveable { mutableStateOf(initial.litres) }
    var rateText by rememberSaveable { mutableStateOf(initial.rate) }
    var notes by rememberSaveable { mutableStateOf(initial.notes) }
    var billPath by rememberSaveable { mutableStateOf(initial.billPath) }
    var billType by rememberSaveable { mutableStateOf("image/jpeg") }

    val isFuel = category == "fuel"
    val litres = ExpenseLogic.positive(litresText, 3)
    val rate = ExpenseLogic.positive(rateText, 2)
    val km = ExpenseLogic.km(odometerText)
    val odometerProblem = km?.let { ExpenseLogic.odometerProblem(it, trip?.openingKm, trip?.closingKm, ExpenseLogic.fillsOf(state.expenses)) }
    val total = ExpenseLogic.fuelTotal(litres, rate)
    val amount = if (isFuel) total else ExpenseLogic.positive(amountText, 2)
    val fuelReady = !isFuel || (km != null && odometerProblem == null && litres != null && rate != null)
    val ready = trip != null && state.canRecord && amount != null && fuelReady && billPath != null
    val level = trip?.authorityLevel

    FieldScreen(
        title = stringResource(R.string.exp_new_title),
        eyebrow = trip?.number?.let { stringResource(R.string.trip_number, it) },
        onBack = onBack,
        bottomBar = {
            PrimaryAction(
                stringResource(R.string.exp_save),
                onClick = {
                    val expense = NewExpense(
                        category = category,
                        amount = amount?.toDouble() ?: 0.0,
                        notes = notes,
                        fuel = if (isFuel && km != null && litres != null && rate != null) FuelDetails(km, fuelType, fullTank, litres.toDouble(), rate.toDouble()) else null,
                    )
                    onSave(expense, billPath?.let { it to billType })
                },
                enabled = ready,
                glyph = Glyph.Check,
            )
        },
    ) {
        if (!state.canRecord) Callout(stringResource(R.string.exp_no_trip), Tone.Attention)
        Eyebrow(stringResource(R.string.exp_select_category))
        CategoryGrid(category) { category = it }
        FieldCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.Truck, Fresh.primary, size = 22.dp)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(stringResource(R.string.drawer_vehicle), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                    Text(trip?.vehicleRegistrationNumber ?: state.day?.vehicleRegistration ?: "—", style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                }
            }
            if (isFuel) {
                FreshTextField(odometerText, { odometerText = it.filter(Char::isDigit).take(7) }, stringResource(R.string.exp_odometer), keyboardType = KeyboardType.Number, leading = Glyph.Gauge, modifier = Modifier.padding(top = 14.dp))
                odometerProblem?.let {
                    Text(
                        when (it) {
                            OdometerProblem.BELOW_OPENING -> stringResource(R.string.exp_odo_below_opening, DayLogic.quantity(trip?.openingKm))
                            OdometerProblem.BELOW_EARLIER_FILL -> stringResource(R.string.exp_odo_below_fill, DayLogic.quantity("${ExpenseLogic.fillsOf(state.expenses).maxOrNull() ?: 0}"))
                            OdometerProblem.ABOVE_RETURN -> stringResource(R.string.exp_odo_above_return, DayLogic.quantity(trip?.closingKm))
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = Fresh.critical,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                Eyebrow(stringResource(R.string.exp_fuel_type), modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
                ChoiceTiles(ExpenseLogic.FUEL_TYPES.map { it to fuelTypeLabel(it) }, fuelType) { fuelType = it }
                Eyebrow(stringResource(R.string.exp_full_tank), modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
                ChoiceTiles(listOf("yes" to stringResource(R.string.yes), "no" to stringResource(R.string.no)), if (fullTank) "yes" else "no") { fullTank = it == "yes" }
                Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FreshTextField(litresText, { litresText = it.filter { c -> c.isDigit() || c == '.' }.take(9) }, stringResource(R.string.exp_litres), keyboardType = KeyboardType.Decimal, modifier = Modifier.weight(1f))
                    FreshTextField(rateText, { rateText = it.filter { c -> c.isDigit() || c == '.' }.take(8) }, stringResource(R.string.exp_rate), keyboardType = KeyboardType.Decimal, prefix = "₹", modifier = Modifier.weight(1f))
                }
                Row(
                    Modifier.fillMaxWidth().padding(top = 14.dp).clip(RoundedCornerShape(16.dp)).background(Fresh.primaryTint).padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.exp_total_amount), style = MaterialTheme.typography.bodyMedium, color = Fresh.primaryStrong)
                        Text(
                            total?.let { stringResource(R.string.rupees, DayLogic.rupees(it.toPlainString())) } ?: "—",
                            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                            color = Fresh.primaryStrong,
                        )
                    }
                    GlyphIcon(Glyph.Rupee, Fresh.primary, size = 28.dp)
                }
            } else {
                FreshTextField(amountText, { amountText = it.filter { c -> c.isDigit() || c == '.' }.take(10) }, stringResource(R.string.amount_rupees), keyboardType = KeyboardType.Decimal, prefix = "₹", modifier = Modifier.padding(top = 14.dp))
            }
        }
        photo(stringResource(if (billPath != null) R.string.exp_bill_taken else R.string.exp_bill_photo), billPath != null) { path, mime ->
            billPath = path
            billType = mime
        }
        if (billPath == null) Text(stringResource(R.string.exp_bill_needed), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
        FreshTextField(notes, { notes = it.take(300) }, stringResource(if (isFuel) R.string.exp_notes_fuel else R.string.notes_optional), singleLine = false)
        if (state.canRecord && level != null && level in 1..3) Callout(stringResource(R.string.exp_owner_approves), Tone.Active)
        Spacer(Modifier.height(4.dp))
    }
}

/** The six categories as tiles, three to a row (design sheet 3). */
@Composable
private fun CategoryGrid(selected: String, onSelect: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ExpenseLogic.CATEGORIES.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { category ->
                    val on = category == selected
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (on) Fresh.primaryTint else Fresh.surface)
                            .border(if (on) 1.5.dp else 1.dp, if (on) Fresh.primary else Fresh.border, RoundedCornerShape(16.dp))
                            .selectable(selected = on, role = Role.RadioButton) { onSelect(category) }
                            .padding(vertical = 14.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        GlyphIcon(categoryGlyph(category), if (on) Fresh.primaryStrong else Fresh.ink, size = 26.dp)
                        Text(categoryLabel(category), style = MaterialTheme.typography.labelLarge, color = if (on) Fresh.primaryStrong else Fresh.ink, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
        }
    }
}
