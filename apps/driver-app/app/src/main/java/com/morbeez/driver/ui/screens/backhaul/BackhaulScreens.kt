package com.morbeez.driver.ui.screens.backhaul

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.R
import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
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
import com.morbeez.driver.ui.screens.collect.AmountProblem
import com.morbeez.driver.ui.screens.collect.methodLabel
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.theme.Fresh
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

private val cameraPhoto: PhotoSlot = { label, captured, onCaptured -> PhotoCaptureButton(label = label, onCaptured = onCaptured, captured = captured) }

/** The trip's backhauls, as this phone has them. */
data class BackhaulUiState(
    val trip: TripEntity? = null,
    val stops: List<TripStopEntity> = emptyList(),
    val backhauls: List<BackhaulEntity> = emptyList(),
    /** The owner's backhaul incentive, percent of the rent (D7); null when they pay none. */
    val incentiveRules: List<com.morbeez.driver.data.remote.dto.IncentiveRuleResponse>? = null,
) {
    val stopsLeft get() = stops.count { it.status == "pending" }
    val onTheRoad get() = trip?.status == "in_progress" && trip.closingKm == null
}

/** Backhaul (D5): Room only — the server's last list and what this phone has done since; every action queued. */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class BackhaulViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
) : ViewModel() {
    val state: StateFlow<BackhaulUiState> = trips.observeActiveTrip().flatMapLatest { trip ->
        if (trip == null) flowOf(BackhaulUiState())
        else combine(trips.observeStops(trip.id), trips.observeBackhauls(trip.id), trips.observeDay()) { stops, backhauls, day ->
            BackhaulUiState(trip, stops, backhauls, trips.earningsOf(day, "week")?.rules)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), BackhaulUiState())

    private fun act(work: suspend (tripId: String) -> Unit) {
        val tripId = state.value.trip?.id ?: return
        viewModelScope.launch {
            work(tripId)
            SyncWorker.requestNow(appContext)
        }
    }

    fun accept(id: String) = act { trips.queueAcceptBackhaul(it, id) }
    fun skip(id: String, reason: String) = act { trips.queueSkipBackhaul(it, id, reason) }
    fun step(id: String, step: String) = act { trips.queueBackhaulStep(it, id, step) }
    fun photo(id: String, type: String, path: String, mime: String) = act { trips.queueBackhaulPhoto(it, id, type, path, mime) }
    fun pay(id: String, method: String, amount: Double, reference: String?, note: String?) = act { trips.queuePayBackhaul(it, id, method, amount, reference, note) }
    fun add(pickup: String, drop: String, rent: Double, hirer: String?, notes: String?, onDone: () -> Unit) = act {
        trips.queueAddBackhaul(it, pickup, drop, rent, hirer, notes)
        onDone()
    }
}

private fun clock(iso: String?): String? = iso?.let {
    runCatching { DateTimeFormatter.ofPattern("hh:mm a").format(Instant.parse(it).atZone(ZoneId.systemDefault())) }.getOrNull()
}

// ---------------------------------------------------------------------------
// Backhaul (design sheet 3: Backhaul Available, Backhaul in Progress, Backhaul Payment)
// ---------------------------------------------------------------------------

@Composable
fun BackhaulScreen(onBack: () -> Unit, onAdd: () -> Unit, onReturn: () -> Unit, viewModel: BackhaulViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    BackhaulContent(
        state = state,
        onBack = onBack,
        onAdd = onAdd,
        onReturn = onReturn,
        onAccept = viewModel::accept,
        onSkip = viewModel::skip,
        onStep = viewModel::step,
        onPhoto = viewModel::photo,
        onPay = viewModel::pay,
    )
}

/**
 * A backhaul (client spec §16–§17): a fixed-rent job on the way back — no
 * product, no kilos, no stock. An offer to accept or skip; once accepted,
 * pickup reached → load complete (photo) → navigate to the drop → drop
 * reached → delivery photo → complete; then what the hirer paid. The
 * others on the trip are listed underneath.
 */
@Composable
internal fun BackhaulContent(
    state: BackhaulUiState,
    onBack: () -> Unit,
    onAdd: () -> Unit,
    onReturn: () -> Unit,
    onAccept: (String) -> Unit,
    onSkip: (String, String) -> Unit,
    onStep: (String, String) -> Unit,
    onPhoto: (id: String, type: String, path: String, mime: String) -> Unit,
    onPay: (id: String, method: String, amount: Double, reference: String?, note: String?) -> Unit,
    photo: PhotoSlot = cameraPhoto,
) {
    var chosen by rememberSaveable { mutableStateOf<String?>(null) }
    val current = state.backhauls.firstOrNull { it.id == chosen }
        ?: BackhaulLogic.currentOf(state.backhauls)
        ?: state.backhauls.lastOrNull { BackhaulLogic.stageOf(it) == BackhaulStage.PAID }
        ?: state.backhauls.lastOrNull()
    val stage = current?.let(BackhaulLogic::stageOf)
    var skipping by rememberSaveable { mutableStateOf(false) }
    // The payment form, kept here so the bottom bar can send it.
    var method by rememberSaveable(current?.id) { mutableStateOf("cash") }
    var amount by rememberSaveable(current?.id) { mutableStateOf(current?.rent?.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString().orEmpty()) }
    var reference by rememberSaveable(current?.id) { mutableStateOf("") }
    var note by rememberSaveable(current?.id) { mutableStateOf("") }
    val amountProblem = current?.let { BackhaulLogic.amountProblem(amount, it.rent) }

    FieldScreen(
        title = stringResource(
            when (stage) {
                BackhaulStage.OFFERED -> R.string.backhaul_available
                BackhaulStage.RUNNING -> R.string.backhaul_in_progress
                BackhaulStage.TO_PAY -> R.string.backhaul_payment
                else -> R.string.drawer_backhaul
            },
        ),
        eyebrow = state.trip?.number,
        onBack = onBack,
        bottomBar = when {
            current == null || !state.onTheRoad && stage != BackhaulStage.TO_PAY -> null
            stage == BackhaulStage.OFFERED -> {
                {
                    // Labels run longer in Malayalam, Kannada and Tamil: no icon, so both fit on one line.
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        PrimaryAction(stringResource(R.string.accept_backhaul), { onAccept(current.id) }, Modifier.weight(1f), glyph = null)
                        SecondaryAction(stringResource(R.string.skip), { skipping = true }, Modifier.weight(1f))
                    }
                }
            }
            stage == BackhaulStage.RUNNING && BackhaulLogic.nextStepOf(current) == "completed" -> {
                { HoldToConfirm(stringResource(R.string.hold_to_complete_backhaul), { onStep(current.id, "completed") }, enabled = current.dropPhotos > 0) }
            }
            stage == BackhaulStage.TO_PAY -> {
                {
                    HoldToConfirm(
                        stringResource(R.string.hold_to_confirm_payment, DayLogic.rupees(amount.ifBlank { "0" })),
                        { amount.trim().toDoubleOrNull()?.let { onPay(current.id, method, it, reference.takeIf { method != "cash" }, note) } },
                        enabled = amountProblem == null,
                    )
                }
            }
            stage == BackhaulStage.PAID -> {
                { PrimaryAction(stringResource(R.string.return_to_base), onReturn, glyph = Glyph.Truck) }
            }
            else -> null
        },
    ) {
        if (current == null) {
            Callout(stringResource(R.string.no_backhaul), Tone.Active, Glyph.Truck)
        } else {
            when (stage) {
                BackhaulStage.OFFERED -> OfferCard(current, com.morbeez.driver.ui.screens.earnings.EarningsLogic.backhaulIncentive(current.rent, state.incentiveRules))
                BackhaulStage.RUNNING -> RunCard(current, state.stopsLeft, onStep, onPhoto, photo)
                BackhaulStage.TO_PAY -> PaymentCard(
                    current,
                    method, { method = it },
                    amount, { amount = it.filter { c -> c.isDigit() || c == '.' }.take(10) },
                    amountProblem,
                    reference, { reference = it.take(60) },
                    note, { note = it.take(300) },
                    onPhoto,
                    photo,
                )
                BackhaulStage.PAID -> {
                    Callout(
                        stringResource(R.string.backhaul_paid, DayLogic.rupees(current.amountReceived), methodLabel(current.paymentMethod.orEmpty())),
                        Tone.Good,
                        Glyph.Check,
                    )
                    RouteCard(current)
                }
                BackhaulStage.SKIPPED -> {
                    Callout(stringResource(R.string.backhaul_skipped, current.skipReason.orEmpty()), Tone.Neutral)
                    RouteCard(current)
                }
                BackhaulStage.CANCELLED -> {
                    Callout(stringResource(R.string.backhaul_cancelled), Tone.Neutral)
                    RouteCard(current)
                }
                null -> Unit
            }
        }
        val others = state.backhauls.filter { it.id != current?.id }
        if (others.isNotEmpty()) {
            Eyebrow(stringResource(R.string.trip_backhauls), modifier = Modifier.padding(top = 8.dp))
            others.forEach { b -> BackhaulRow(b) { chosen = b.id } }
        }
        // Another one, once nothing here waits for the driver.
        if (state.onTheRoad && BackhaulLogic.currentOf(state.backhauls) == null) {
            SecondaryAction(stringResource(R.string.add_backhaul), onAdd, Modifier.padding(top = 4.dp), glyph = Glyph.Truck)
        }
    }

    if (skipping && current != null) {
        SkipDialog(onDismiss = { skipping = false }) { reason ->
            skipping = false
            onSkip(current.id, reason)
        }
    }
}

/** The pickup, the drop, the rent: what the offer is. */
@Composable
private fun RouteCard(b: BackhaulEntity) {
    FieldCard {
        PlaceRow(Glyph.Pin, Fresh.primary, stringResource(R.string.backhaul_pickup), b.pickupPlace)
        HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
        PlaceRow(Glyph.Pin, Fresh.critical, stringResource(R.string.backhaul_drop), b.dropPlace)
        HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlyphIcon(Glyph.Rupee, Fresh.primary, size = 22.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(stringResource(R.string.fixed_rent), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                Text(stringResource(R.string.rupees, DayLogic.rupees(b.rent)), style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold), color = Fresh.primary)
            }
        }
        val who = listOfNotNull(
            stringResource(if (b.offeredBy == "owner") R.string.offered_by_owner else R.string.taken_on_road),
            b.hirerName?.let { stringResource(R.string.hired_by, it) },
        ).joinToString(" · ")
        Text(who, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 10.dp))
        b.notes?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Fresh.ink, modifier = Modifier.padding(top = 4.dp)) }
    }
}

@Composable
private fun PlaceRow(glyph: Glyph, tint: Color, label: String, place: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        GlyphIcon(glyph, tint, size = 22.dp)
        Spacer(Modifier.width(12.dp))
        Column {
            Text(label, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
            Text(place, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
        }
    }
}

@Composable
private fun OfferCard(b: BackhaulEntity, incentive: java.math.BigDecimal?) {
    Callout(stringResource(R.string.backhaul_available_hint), Tone.Good, Glyph.Truck)
    RouteCard(b)
    // The owner's backhaul incentive on this rent (D7), as the design sheet shows it.
    incentive?.let { Callout(stringResource(R.string.backhaul_incentive_if, DayLogic.rupees(it.toPlainString())), Tone.Active, Glyph.Rupee) }
    // No product, no kilos, no stock: a transport job only.
    FieldCard {
        listOf(R.string.no_product to R.string.no_vegetable, R.string.no_kg to R.string.no_inventory).forEach { (left, right) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                NoChip(stringResource(left), Modifier.weight(1f))
                NoChip(stringResource(right), Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun NoChip(text: String, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        GlyphIcon(Glyph.Check, Fresh.inkMuted, size = 16.dp)
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
    }
}

/** Under way: each step in order; the current one with what it needs. */
@Composable
private fun RunCard(
    b: BackhaulEntity,
    stopsLeft: Int,
    onStep: (String, String) -> Unit,
    onPhoto: (id: String, type: String, path: String, mime: String) -> Unit,
    photo: PhotoSlot,
) {
    val context = LocalContext.current
    val next = BackhaulLogic.nextStepOf(b)
    val block = BackhaulLogic.blockOf(b, stopsLeft)
    val open = { place: String -> if (!FieldIntents.navigate(context, null, null, place, place)) Toast.makeText(context, R.string.no_app_for_link, Toast.LENGTH_SHORT).show() }
    Text(stringResource(R.string.backhaul_route, b.pickupPlace, b.dropPlace), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
    FieldCard {
        StepRow(stringResource(R.string.step_pickup_reached), b.pickupPlace, b.pickupReachedAt, next == "pickup_reached") {
            if (block == StepBlock.STOPS_LEFT) Callout(stringResource(R.string.backhaul_after_stops, stopsLeft), Tone.Attention)
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TonalAction(stringResource(R.string.navigate), Glyph.Navigate, Fresh.primaryTint, Fresh.primaryStrong, Modifier.weight(1f)) { open(b.pickupPlace) }
                TonalAction(stringResource(R.string.step_pickup_reached), Glyph.Check, Fresh.carbon, Fresh.onCarbon, Modifier.weight(1f), enabled = block == null) { onStep(b.id, "pickup_reached") }
            }
        }
        StepRow(stringResource(R.string.load_complete), null, b.loadedAt, next == "loaded", photos = b.loadPhotos) {
            photo(stringResource(if (b.loadPhotos > 0) R.string.photo_load_another else R.string.photo_load), false) { path, mime -> onPhoto(b.id, "load", path, mime) }
            if (block == StepBlock.LOAD_PHOTO) Text(stringResource(R.string.needs_load_photo), style = MaterialTheme.typography.bodySmall, color = Fresh.warning, modifier = Modifier.padding(top = 6.dp))
            TonalAction(stringResource(R.string.load_complete), Glyph.Check, Fresh.carbon, Fresh.onCarbon, Modifier.fillMaxWidth().padding(top = 8.dp), enabled = block == null) { onStep(b.id, "loaded") }
        }
        StepRow(stringResource(R.string.step_drop_reached), b.dropPlace, b.dropReachedAt, next == "drop_reached") {
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TonalAction(stringResource(R.string.open_maps), Glyph.Navigate, Fresh.primaryTint, Fresh.primaryStrong, Modifier.weight(1f)) { open(b.dropPlace) }
                TonalAction(stringResource(R.string.step_drop_reached), Glyph.Check, Fresh.carbon, Fresh.onCarbon, Modifier.weight(1f)) { onStep(b.id, "drop_reached") }
            }
        }
        StepRow(stringResource(R.string.step_complete_backhaul), null, b.completedAt, next == "completed", photos = b.dropPhotos, last = true) {
            photo(stringResource(if (b.dropPhotos > 0) R.string.photo_delivery_another else R.string.photo_delivery), false) { path, mime -> onPhoto(b.id, "drop", path, mime) }
            if (block == StepBlock.DROP_PHOTO) Text(stringResource(R.string.needs_drop_photo), style = MaterialTheme.typography.bodySmall, color = Fresh.warning, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/** One step: done (with its time), the one to do now (with its actions), or still to come. */
@Composable
private fun StepRow(
    label: String,
    where: String?,
    doneAt: String?,
    current: Boolean,
    photos: Int = 0,
    last: Boolean = false,
    actions: @Composable () -> Unit,
) {
    val done = doneAt != null
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Box(
            Modifier.size(26.dp).clip(CircleShape).background(if (done) Fresh.primary else if (current) Fresh.carbon else Fresh.surface3),
            contentAlignment = Alignment.Center,
        ) {
            if (done) GlyphIcon(Glyph.Check, Color.White, size = 14.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.titleSmall, color = if (done || current) Fresh.ink else Fresh.inkMuted, modifier = Modifier.weight(1f))
                clock(doneAt)?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Fresh.inkMuted) }
            }
            where?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted) }
            if (photos > 0) Pill(pluralStringResource(R.plurals.n_photos, photos, photos), Tone.Good)
            if (current) actions()
        }
    }
    if (!last) HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(start = 38.dp))
}

@Composable
private fun PaymentCard(
    b: BackhaulEntity,
    method: String,
    onMethod: (String) -> Unit,
    amount: String,
    onAmount: (String) -> Unit,
    problem: AmountProblem?,
    reference: String,
    onReference: (String) -> Unit,
    note: String,
    onNote: (String) -> Unit,
    onPhoto: (id: String, type: String, path: String, mime: String) -> Unit,
    photo: PhotoSlot,
) {
    Callout(stringResource(R.string.backhaul_completed), Tone.Good, Glyph.Check)
    FieldCard {
        Text(stringResource(R.string.backhaul_route, b.pickupPlace, b.dropPlace), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
        Text(stringResource(R.string.fixed_rent), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 10.dp))
        Text(stringResource(R.string.rupees, DayLogic.rupees(b.rent)), style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold), color = Fresh.primary)
    }
    FieldCard {
        Eyebrow(stringResource(R.string.payment_method))
        ChoiceTiles(BACKHAUL_METHODS.map { it to methodLabel(it) }, method, onMethod)
        if (method != "cash") FreshTextField(reference, onReference, stringResource(R.string.reference_utr), Modifier.padding(top = 12.dp))
        Text(
            stringResource(if (method == "cash") R.string.cash_to_hand_over_note else R.string.direct_note),
            style = MaterialTheme.typography.bodySmall,
            color = Fresh.inkMuted,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
    FreshTextField(amount, onAmount, stringResource(R.string.amount_received), keyboardType = KeyboardType.Decimal, prefix = "₹")
    val typed = amount.trim().toBigDecimalOrNull()
    val rent = b.rent.toBigDecimalOrNull()
    when {
        problem == AmountProblem.MORE_THAN_OWED -> Text(stringResource(R.string.more_than_rent, DayLogic.rupees(b.rent)), style = MaterialTheme.typography.bodySmall, color = Fresh.critical)
        problem == AmountProblem.BAD_NUMBER -> Text(stringResource(R.string.number_only), style = MaterialTheme.typography.bodySmall, color = Fresh.critical)
        problem == null && typed != null && rent != null && typed < rent ->
            Text(stringResource(R.string.less_than_rent, DayLogic.rupees((rent - typed).toPlainString())), style = MaterialTheme.typography.bodySmall, color = Fresh.warning)
    }
    photo(stringResource(if (b.paymentPhotos > 0) R.string.photo_attached else R.string.photo_payment_proof), b.paymentPhotos > 0) { path, mime -> onPhoto(b.id, "payment", path, mime) }
    FreshTextField(note, onNote, stringResource(R.string.notes_optional), singleLine = false)
}

/** Another backhaul on the trip: tap to open it. */
@Composable
private fun BackhaulRow(b: BackhaulEntity, onOpen: () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = Fresh.surface, border = BorderStroke(1.dp, Fresh.border), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.clickable(role = Role.Button, onClick = onOpen).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.backhaul_route, b.pickupPlace, b.dropPlace), style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
                Text(stringResource(R.string.rupees, DayLogic.rupees(b.rent)), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
            }
            StagePill(BackhaulLogic.stageOf(b))
        }
    }
}

@Composable
fun StagePill(stage: BackhaulStage) = when (stage) {
    BackhaulStage.OFFERED -> Pill(stringResource(R.string.pill_offered), Tone.Attention)
    BackhaulStage.RUNNING -> Pill(stringResource(R.string.pill_under_way), Tone.Active)
    BackhaulStage.TO_PAY -> Pill(stringResource(R.string.pill_to_pay), Tone.Attention)
    BackhaulStage.PAID -> Pill(stringResource(R.string.pill_paid), Tone.Good)
    BackhaulStage.SKIPPED -> Pill(stringResource(R.string.pill_skipped), Tone.Neutral)
    BackhaulStage.CANCELLED -> Pill(stringResource(R.string.pill_cancelled), Tone.Neutral)
}

private val SKIP_REASONS = listOf(R.string.skip_vehicle_needed, R.string.skip_too_far, R.string.skip_rent_low, R.string.skip_not_fit)

/** Why not: the owner hears. */
@Composable
private fun SkipDialog(onDismiss: () -> Unit, onSkip: (String) -> Unit) {
    val reasons = SKIP_REASONS.map { stringResource(it) }
    val otherLabel = stringResource(R.string.reason_other)
    var choice by rememberSaveable { mutableStateOf(reasons.first()) }
    var other by rememberSaveable { mutableStateOf("") }
    val reason = if (choice == otherLabel) other.trim() else choice
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fresh.surface,
        title = { Text(stringResource(R.string.skip_backhaul_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.skip_backhaul_hint), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
                ChoiceTiles((reasons + otherLabel).map { it to it }, choice) { choice = it }
                if (choice == otherLabel) FreshTextField(other, { other = it.take(300) }, stringResource(R.string.skip_why))
            }
        },
        confirmButton = { TextButton(onClick = { onSkip(reason) }, enabled = reason.length >= 3) { Text(stringResource(R.string.skip), color = Fresh.critical) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
    )
}

// ---------------------------------------------------------------------------
// Add a backhaul taken on the road (the client's answer 6: the driver can create one)
// ---------------------------------------------------------------------------

@Composable
fun AddBackhaulScreen(onBack: () -> Unit, onDone: () -> Unit, viewModel: BackhaulViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    AddBackhaulContent(state, onBack) { pickup, drop, rent, hirer, notes -> viewModel.add(pickup, drop, rent, hirer, notes, onDone) }
}

@Composable
internal fun AddBackhaulContent(
    state: BackhaulUiState,
    onBack: () -> Unit,
    onAdd: (pickup: String, drop: String, rent: Double, hirer: String?, notes: String?) -> Unit,
) {
    var pickup by rememberSaveable { mutableStateOf("") }
    var drop by rememberSaveable { mutableStateOf("") }
    var rent by rememberSaveable { mutableStateOf("") }
    var hirer by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    val problem = BackhaulLogic.addProblem(pickup, drop, rent)
    FieldScreen(
        title = stringResource(R.string.add_backhaul),
        eyebrow = state.trip?.number,
        onBack = onBack,
        bottomBar = {
            PrimaryAction(
                stringResource(R.string.add_backhaul),
                { rent.trim().toDoubleOrNull()?.let { onAdd(pickup, drop, it, hirer.ifBlank { null }, notes.ifBlank { null }) } },
                enabled = problem == null && state.onTheRoad,
                glyph = Glyph.Check,
            )
        },
    ) {
        Callout(stringResource(R.string.add_backhaul_hint), Tone.Active, Glyph.Truck)
        FreshTextField(pickup, { pickup = it.take(120) }, stringResource(R.string.backhaul_pickup), leading = Glyph.Pin)
        FreshTextField(drop, { drop = it.take(120) }, stringResource(R.string.backhaul_drop), leading = Glyph.Pin)
        FreshTextField(rent, { rent = it.filter { c -> c.isDigit() || c == '.' }.take(10) }, stringResource(R.string.fixed_rent), keyboardType = KeyboardType.Decimal, prefix = "₹")
        if (problem == AddProblem.RENT && rent.isNotBlank()) Text(stringResource(R.string.number_only), style = MaterialTheme.typography.bodySmall, color = Fresh.critical)
        FreshTextField(hirer, { hirer = it.take(120) }, stringResource(R.string.hirer_optional), leading = Glyph.User)
        FreshTextField(notes, { notes = it.take(500) }, stringResource(R.string.notes_optional), singleLine = false)
    }
}
