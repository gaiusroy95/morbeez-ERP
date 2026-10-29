package com.morbeez.driver.ui.screens.farm

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.data.local.Decision
import com.morbeez.driver.data.local.FarmDraft
import com.morbeez.driver.data.local.FarmLineDraft
import com.morbeez.driver.data.remote.dto.CrewOptionResponse
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.ui.components.Callout
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
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.clockOf
import com.morbeez.driver.ui.theme.Fresh
import java.math.BigDecimal
import java.time.Instant

/** The farmer stop's screens (design sheet 4 Farmer stop, 6 Packing & weigh, 7 Load complete). */
enum class FarmStep { PRODUCTS, PACK, WEIGH, LOAD }

/** A photo button; the screenshot tests pass one that needs no camera. */
typealias PhotoSlot = @Composable (label: String, captured: Boolean, onCaptured: (path: String, mimeType: String) -> Unit) -> Unit

private val cameraPhoto: PhotoSlot = { label, captured, onCaptured -> PhotoCaptureButton(label = label, onCaptured = onCaptured, captured = captured) }

@Composable
fun FarmStopScreen(
    onBack: () -> Unit,
    onDone: () -> Unit,
    onReport: () -> Unit,
    viewModel: FarmStopViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var step by rememberSaveable { mutableStateOf(FarmStep.PRODUCTS) }
    var rejecting by rememberSaveable { mutableStateOf<String?>(null) }

    // Back walks the steps; only from the products does it leave the farm.
    BackHandler(enabled = rejecting != null || step != FarmStep.PRODUCTS) {
        if (rejecting != null) rejecting = null else step = previousOf(step, state)
    }

    FarmStopContent(
        state = state,
        step = step,
        onStep = { step = it },
        rejecting = rejecting,
        onRejecting = { rejecting = it },
        onBack = onBack,
        onArrive = viewModel::arrive,
        onEdit = viewModel::edit,
        onLoadPhoto = viewModel::loadPhoto,
        onRejectionPhoto = viewModel::rejectionPhoto,
        onComplete = { viewModel.complete(onDone) },
        onReport = onReport,
    )
}

/** The step before [step]: the Weigh tab's "back" is the Pack tab; a farm with nothing loaded skips both. */
private fun previousOf(step: FarmStep, state: FarmUiState): FarmStep = when (step) {
    FarmStep.LOAD -> if (state.draft?.let(FarmLogic::anyAccepted) == true) FarmStep.WEIGH else FarmStep.PRODUCTS
    FarmStep.WEIGH -> FarmStep.PACK
    else -> FarmStep.PRODUCTS
}

/** The farmer stop from state alone (the screenshot tests draw it with a sample farm). */
@Composable
internal fun FarmStopContent(
    state: FarmUiState,
    step: FarmStep,
    onStep: (FarmStep) -> Unit,
    rejecting: String?,
    onRejecting: (String?) -> Unit,
    onBack: () -> Unit,
    onArrive: () -> Unit,
    onEdit: ((FarmDraft) -> FarmDraft) -> Unit,
    onLoadPhoto: (String, String) -> Unit,
    onRejectionPhoto: (String, String, String) -> Unit,
    onComplete: () -> Unit,
    onReport: () -> Unit,
    photo: PhotoSlot = cameraPhoto,
) {
    val stop = state.stop ?: return
    val draft = state.draft ?: return
    if (stop.status != "pending") {
        CompletedFarm(state, onBack)
        return
    }
    val rejectItem = rejecting?.let { id -> state.items.firstOrNull { it.productId == id } }
    if (rejectItem != null) {
        RejectProduct(
            item = rejectItem,
            line = draft.lines.firstOrNull { it.productId == rejectItem.productId } ?: FarmLineDraft(rejectItem.productId),
            onCancel = { onRejecting(null) },
            onConfirm = { reason, note ->
                onEdit { d -> d.withLine(rejectItem.productId) { it.copy(decision = Decision.REJECTED, reason = reason, note = note) } }
                onRejecting(null)
            },
            onPhoto = { path, mime -> onRejectionPhoto(rejectItem.productId, path, mime) },
            photo = photo,
        )
        return
    }
    when (step) {
        FarmStep.PRODUCTS -> Products(state, draft, onBack, onArrive, onEdit, onRejecting, onReport, next = {
            onStep(if (FarmLogic.anyAccepted(draft)) FarmStep.PACK else FarmStep.LOAD)
        })
        FarmStep.PACK, FarmStep.WEIGH -> PackAndWeigh(state, draft, step, onStep, onEdit)
        FarmStep.LOAD -> LoadComplete(state, draft, onStep, onLoadPhoto, onComplete, photo)
    }
}

private fun FarmDraft.withLine(productId: String, change: (FarmLineDraft) -> FarmLineDraft) =
    copy(lines = lines.map { if (it.productId == productId) change(it) else it })

private fun reasonLabel(reason: String?): Int = when (reason) {
    "quality_issue" -> R.string.reason_quality_issue
    "quantity_short" -> R.string.reason_quantity_short
    "damaged" -> R.string.reason_damaged
    "farmer_not_ready" -> R.string.reason_farmer_not_ready
    else -> R.string.reason_other
}

/** "500 kg"; eggs in their own word. */
@Composable
private fun amount(quantity: String?, uom: String): String =
    stringResource(R.string.amount_unit, DayLogic.quantity(quantity), if (uom == "piece") stringResource(R.string.eggs) else uom)

// ---------------------------------------------------------------------------
// Farmer stop: each product accepted or rejected
// ---------------------------------------------------------------------------

@Composable
private fun Products(
    state: FarmUiState,
    draft: FarmDraft,
    onBack: () -> Unit,
    onArrive: () -> Unit,
    onEdit: ((FarmDraft) -> FarmDraft) -> Unit,
    onRejecting: (String?) -> Unit,
    onReport: () -> Unit,
    next: () -> Unit,
) {
    val stop = state.stop ?: return
    val context = LocalContext.current
    val readiness = FarmLogic.readinessOf(draft, state.items)
    val canDecide = state.arrived && state.canBuy
    FieldScreen(
        title = stop.counterpartyName,
        eyebrow = stringResource(R.string.farm_stop_eyebrow, stop.sequenceNumber),
        onBack = onBack,
        headerExtra = {
            val eta = DayLogic.etaTo(state.position?.latitude, state.position?.longitude, stop)
            val meta = listOfNotNull(stop.partyPlace, eta?.let { stringResource(R.string.eta, DayLogic.kmLabel(it.km), it.minutes) }).joinToString(" · ")
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = Fresh.onCarbonMuted, modifier = Modifier.padding(top = 6.dp))
            Row(Modifier.padding(top = 12.dp)) {
                val arrivedAt = stop.arrivedAt?.let { runCatching { clockOf(Instant.parse(it).toEpochMilli()) }.getOrNull() }
                if (arrivedAt != null) Pill(stringResource(R.string.reached_at, arrivedAt), Tone.Lime)
                else Pill(stringResource(R.string.not_reached), Tone.Neutral, onDark = true)
            }
        },
        bottomBar = {
            if (!state.arrived) {
                PrimaryAction(stringResource(R.string.start_pickup), onArrive, glyph = Glyph.Arrow, enabled = state.canBuy)
            } else {
                PrimaryAction(
                    stringResource(if (FarmLogic.anyAccepted(draft) || !readiness.decided) R.string.pack_and_weigh else R.string.review_and_complete),
                    next,
                    enabled = readiness.decided,
                )
            }
        },
    ) {
        if (!state.canBuy) Callout(stringResource(R.string.needs_level_3), Tone.Attention)
        else if (!state.arrived) Callout(stringResource(R.string.start_pickup_hint), Tone.Active, Glyph.Pin)

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TonalAction(stringResource(R.string.call), Glyph.Phone, Fresh.surface, Fresh.primary, Modifier.weight(1f), enabled = stop.partyPhone != null) {
                stop.partyPhone?.let { FieldIntents.dial(context, it) }
            }
            TonalAction(
                stringResource(R.string.navigate),
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

        Eyebrow(pluralStringResource(R.plurals.n_products, state.items.size, state.items.size), modifier = Modifier.padding(start = 4.dp, top = 4.dp))
        state.items.forEach { item ->
            val line = draft.lines.firstOrNull { it.productId == item.productId } ?: FarmLineDraft(item.productId)
            ProductCard(
                item = item,
                line = line,
                enabled = canDecide,
                onAccept = { onEdit { d -> d.withLine(item.productId) { it.copy(decision = Decision.ACCEPTED, reason = null) } } },
                onReject = { onRejecting(item.productId) },
                onUndo = { onEdit { d -> d.withLine(item.productId) { it.copy(decision = null) } } },
            )
        }
        SecondaryAction(stringResource(R.string.skip_or_report), onReport, glyph = Glyph.Warning)
    }
}

@Composable
private fun ProductAvatar(name: String, tint: Color = Fresh.primaryTint, ink: Color = Fresh.primaryStrong) {
    Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(tint), contentAlignment = Alignment.Center) {
        Text(name.take(1).uppercase(), style = MaterialTheme.typography.titleLarge, color = ink)
    }
}

@Composable
private fun ProductCard(
    item: StopItemResponse,
    line: FarmLineDraft,
    enabled: Boolean,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onUndo: () -> Unit,
) {
    FieldCard(highlight = line.decision == null && enabled) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ProductAvatar(item.productName)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.productName, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                Text(stringResource(R.string.planned_amount, amount(item.quantity, item.uom)), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
            }
            when (line.decision) {
                Decision.ACCEPTED -> Pill(stringResource(R.string.accepted), Tone.Good)
                Decision.REJECTED -> Pill(stringResource(R.string.rejected), Tone.Bad)
                null -> Unit
            }
        }
        when (line.decision) {
            null -> Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TonalAction(stringResource(R.string.accept), Glyph.Check, Fresh.primary, Color.White, Modifier.weight(1f), enabled = enabled, onClick = onAccept)
                TonalAction(stringResource(R.string.reject), null, Fresh.criticalTint, Fresh.critical, Modifier.weight(1f), enabled = enabled, onClick = onReject)
            }
            Decision.REJECTED -> {
                Text(
                    listOfNotNull(stringResource(reasonLabel(line.reason)), line.note.trim().ifBlank { null }).joinToString(" — "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.critical,
                    modifier = Modifier.padding(top = 10.dp),
                )
                ChangeLink(onUndo)
            }
            Decision.ACCEPTED -> ChangeLink(onUndo)
        }
    }
}

@Composable
private fun ChangeLink(onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.padding(top = 2.dp)) {
        Text(stringResource(R.string.change), style = MaterialTheme.typography.labelLarge, color = Fresh.primary)
    }
}

// ---------------------------------------------------------------------------
// Reject product (design sheet screen 5)
// ---------------------------------------------------------------------------

@Composable
private fun RejectProduct(
    item: StopItemResponse,
    line: FarmLineDraft,
    onCancel: () -> Unit,
    onConfirm: (reason: String, note: String) -> Unit,
    onPhoto: (String, String) -> Unit,
    photo: PhotoSlot,
) {
    var reason by rememberSaveable(item.productId) { mutableStateOf(line.reason) }
    var note by rememberSaveable(item.productId) { mutableStateOf(line.note) }
    FieldScreen(
        title = stringResource(R.string.reject_product),
        eyebrow = item.productName,
        onBack = onCancel,
        bottomBar = { PrimaryAction(stringResource(R.string.confirm_reject), { reason?.let { onConfirm(it, note.trim()) } }, enabled = reason != null, glyph = null, danger = true) },
    ) {
        FieldCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProductAvatar(item.productName, Fresh.criticalTint, Fresh.critical)
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(item.productName, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                    Text(stringResource(R.string.planned_amount, amount(item.quantity, item.uom)), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                }
            }
        }
        FieldCard {
            Eyebrow(stringResource(R.string.reason_for_rejection))
            Spacer(Modifier.padding(top = 4.dp))
            REJECT_REASONS.forEach { code ->
                val on = reason == code
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .selectable(selected = on, role = Role.RadioButton) { reason = code }
                        .padding(vertical = 10.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(22.dp).clip(CircleShape).background(if (on) Fresh.primary else Fresh.surface).border(2.dp, if (on) Fresh.primary else Fresh.borderStrong, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (on) GlyphIcon(Glyph.Check, Color.White, size = 14.dp)
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(reasonLabel(code)), style = MaterialTheme.typography.bodyLarge, color = Fresh.ink)
                }
            }
        }
        FreshTextField(value = note, onValueChange = { note = it.take(500) }, label = stringResource(R.string.notes_optional), singleLine = false)
        photo(stringResource(if (line.rejectionPhoto) R.string.photo_attached else R.string.photo_rejection), line.rejectionPhoto, onPhoto)
    }
}

// ---------------------------------------------------------------------------
// Packing & weigh (design sheet screen 6)
// ---------------------------------------------------------------------------

@Composable
private fun PackAndWeigh(
    state: FarmUiState,
    draft: FarmDraft,
    step: FarmStep,
    onStep: (FarmStep) -> Unit,
    onEdit: ((FarmDraft) -> FarmDraft) -> Unit,
) {
    val stop = state.stop ?: return
    val accepted = state.items.filter { item -> draft.lines.any { it.productId == item.productId && it.decision == Decision.ACCEPTED } }
    val anyKg = accepted.any(FarmLogic::bagsApply)
    val weighed = FarmLogic.readinessOf(draft, state.items).weighed
    FieldScreen(
        title = stringResource(R.string.packing_and_weigh),
        eyebrow = stop.counterpartyName,
        onBack = { onStep(if (step == FarmStep.WEIGH) FarmStep.PACK else FarmStep.PRODUCTS) },
        headerExtra = {
            Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StepTab(stringResource(R.string.tab_pack), step == FarmStep.PACK) { onStep(FarmStep.PACK) }
                StepTab(stringResource(R.string.tab_weigh), step == FarmStep.WEIGH) { onStep(FarmStep.WEIGH) }
            }
        },
        bottomBar = {
            if (step == FarmStep.PACK) PrimaryAction(stringResource(R.string.continue_label), { onStep(FarmStep.WEIGH) })
            else PrimaryAction(stringResource(R.string.continue_label), { onStep(FarmStep.LOAD) }, enabled = weighed)
        },
    ) {
        if (step == FarmStep.PACK) {
            FieldCard {
                Eyebrow(stringResource(R.string.packing_crew))
                CrewPicker(stringResource(R.string.packer), draft.packerId, state.crew) { id -> onEdit { it.copy(packerId = id) } }
                if (!draft.samePerson) CrewPicker(stringResource(R.string.loader), draft.loaderId, state.crew) { id -> onEdit { it.copy(loaderId = id) } }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable(role = Role.Checkbox) { onEdit { it.copy(samePerson = !it.samePerson) } },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(
                        checked = draft.samePerson,
                        onCheckedChange = null,
                        colors = CheckboxDefaults.colors(checkedColor = Fresh.primary, uncheckedColor = Fresh.borderStrong),
                        modifier = Modifier.padding(8.dp),
                    )
                    Text(stringResource(R.string.same_person), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink)
                }
                if (state.crew.isEmpty()) Text(stringResource(R.string.no_crew), style = MaterialTheme.typography.bodySmall, color = Fresh.warning)
            }
            if (anyKg) {
                FieldCard {
                    Eyebrow(stringResource(R.string.unit))
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        UnitTile(stringResource(R.string.unit_kg), !draft.byBags, Modifier.weight(1f)) { onEdit { it.copy(byBags = false) } }
                        UnitTile(stringResource(R.string.unit_bags), draft.byBags, Modifier.weight(1f)) { onEdit { it.copy(byBags = true) } }
                    }
                    Text(
                        stringResource(if (draft.byBags) R.string.unit_bags_hint else R.string.unit_kg_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = Fresh.inkMuted,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
            FieldCard {
                Eyebrow(stringResource(R.string.sacks_bags))
                accepted.forEach { item ->
                    val line = draft.lines.first { it.productId == item.productId }
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(item.productName, style = MaterialTheme.typography.titleSmall, color = Fresh.ink, modifier = Modifier.weight(1f))
                        FreshTextField(
                            value = line.sacks,
                            onValueChange = { typed -> onEdit { d -> d.withLine(item.productId) { it.copy(sacks = typed.filter(Char::isDigit).take(5)) } } },
                            label = stringResource(R.string.sacks),
                            keyboardType = KeyboardType.Number,
                            modifier = Modifier.width(120.dp),
                        )
                    }
                }
            }
        } else {
            accepted.forEach { item ->
                val line = draft.lines.first { it.productId == item.productId }
                WeighCard(item, line, draft.byBags && FarmLogic.bagsApply(item)) { change -> onEdit { d -> d.withLine(item.productId, change) } }
            }
        }
    }
}

@Composable
private fun StepTab(text: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(if (selected) Fresh.accent else Fresh.carbon3)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 8.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (selected) Fresh.accentInk else Fresh.onCarbon)
    }
}

@Composable
private fun UnitTile(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Fresh.carbon else Fresh.surface)
            .border(1.dp, if (selected) Fresh.carbon else Fresh.borderStrong, RoundedCornerShape(14.dp))
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (selected) Fresh.onCarbon else Fresh.ink)
    }
}

/** A worker chosen from the business's own (the client's answer 4), in a list that opens on tap. */
@Composable
private fun CrewPicker(label: String, selectedId: String?, crew: List<CrewOptionResponse>, onPick: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val chosen = crew.firstOrNull { it.employeeId == selectedId }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, if (chosen != null) Fresh.primary else Fresh.borderStrong, RoundedCornerShape(14.dp))
            .clickable(enabled = crew.isNotEmpty(), role = Role.Button) { open = true }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlyphIcon(Glyph.User, if (chosen != null) Fresh.primary else Fresh.inkMuted, size = 20.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
            Text(chosen?.name ?: stringResource(R.string.choose), style = MaterialTheme.typography.titleMedium, color = if (chosen != null) Fresh.ink else Fresh.inkFaint)
        }
        GlyphIcon(Glyph.ChevronRight, Fresh.inkFaint, size = 18.dp)
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            containerColor = Fresh.surface,
            title = { Text(label, style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                    crew.forEach { worker ->
                        val on = worker.employeeId == selectedId
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(if (on) Fresh.carbon else Fresh.surface2)
                                .selectable(selected = on, role = Role.RadioButton) {
                                    onPick(worker.employeeId)
                                    open = false
                                }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(worker.name, style = MaterialTheme.typography.titleMedium, color = if (on) Fresh.onCarbon else Fresh.ink, modifier = Modifier.weight(1f))
                            Text(roleLabel(worker.roleType), style = MaterialTheme.typography.bodySmall, color = if (on) Fresh.onCarbonMuted else Fresh.inkMuted)
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
        )
    }
}

@Composable
private fun roleLabel(roleType: String): String = stringResource(
    when (roleType) {
        "warehouse" -> R.string.role_warehouse
        "driver" -> R.string.role_driver
        "procurement" -> R.string.role_procurement
        "finance" -> R.string.role_finance
        else -> R.string.role_other
    },
)

@Composable
private fun WeighCard(item: StopItemResponse, line: FarmLineDraft, byBags: Boolean, onChange: ((FarmLineDraft) -> FarmLineDraft) -> Unit) {
    val decimal = { typed: String -> typed.filter { it.isDigit() || it == '.' }.take(10) }
    FieldCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ProductAvatar(item.productName)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.productName, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                Text(stringResource(R.string.planned_amount, amount(item.quantity, item.uom)), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
            }
        }
        if (byBags) {
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FreshTextField(
                    value = line.sacks,
                    onValueChange = { typed -> onChange { it.copy(sacks = typed.filter(Char::isDigit).take(5)) } },
                    label = stringResource(R.string.bags),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
                FreshTextField(
                    value = line.kgPerBag,
                    onValueChange = { typed -> onChange { it.copy(kgPerBag = decimal(typed)) } },
                    label = stringResource(R.string.kg_per_bag),
                    keyboardType = KeyboardType.Decimal,
                    modifier = Modifier.weight(1f),
                )
            }
        } else {
            FreshTextField(
                value = line.weight,
                onValueChange = { typed -> onChange { it.copy(weight = decimal(typed)) } },
                label = stringResource(R.string.net_weight, if (item.uom == "piece") stringResource(R.string.eggs) else item.uom),
                keyboardType = KeyboardType.Decimal,
                leading = Glyph.Gauge,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
        val problem = FarmLogic.problemOf(line, item, byBags)
        val total = FarmLogic.quantityOf(line, item, byBags)
        Text(
            when {
                total != null && byBags -> stringResource(R.string.bags_total, line.sacks, DayLogic.quantity(line.kgPerBag), amount(total.toPlainString(), item.uom))
                total != null -> stringResource(R.string.loaded_amount, amount(total.toPlainString(), item.uom))
                problem == LineProblem.BAD_NUMBER -> stringResource(R.string.number_only)
                byBags -> stringResource(R.string.bags_hint)
                else -> stringResource(R.string.weigh_hint)
            },
            style = MaterialTheme.typography.bodySmall,
            color = if (problem == LineProblem.BAD_NUMBER) Fresh.critical else if (total != null) Fresh.primary else Fresh.inkMuted,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

// ---------------------------------------------------------------------------
// Load complete (design sheet screen 7)
// ---------------------------------------------------------------------------

@Composable
private fun LoadComplete(
    state: FarmUiState,
    draft: FarmDraft,
    onStep: (FarmStep) -> Unit,
    onLoadPhoto: (String, String) -> Unit,
    onComplete: () -> Unit,
    photo: PhotoSlot,
) {
    val stop = state.stop ?: return
    val readiness = FarmLogic.readinessOf(draft, state.items)
    val loads = FarmLogic.anyAccepted(draft)
    FieldScreen(
        title = stop.counterpartyName,
        eyebrow = stringResource(R.string.load_complete),
        onBack = { onStep(if (loads) FarmStep.WEIGH else FarmStep.PRODUCTS) },
        bottomBar = {
            HoldToConfirm(stringResource(R.string.hold_to_complete_farm), onComplete, enabled = readiness.ready && state.canBuy)
        },
    ) {
        FieldCard {
            state.items.forEachIndexed { i, item ->
                val line = draft.lines.firstOrNull { it.productId == item.productId } ?: return@forEachIndexed
                if (i > 0) HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
                val accepted = line.decision == Decision.ACCEPTED
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(26.dp).clip(CircleShape).background(if (accepted) Fresh.primary else Fresh.criticalTint),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (accepted) GlyphIcon(Glyph.Check, Color.White, size = 14.dp)
                        else Text("×", style = MaterialTheme.typography.titleMedium, color = Fresh.critical)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.productName, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                        if (!accepted) Text(stringResource(reasonLabel(line.reason)), style = MaterialTheme.typography.bodySmall, color = Fresh.critical)
                    }
                    if (accepted) {
                        val q = FarmLogic.quantityOf(line, item, draft.byBags)
                        Text(if (q != null) amount(q.toPlainString(), item.uom) else "—", style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                    }
                    TextButton(onClick = { onStep(if (accepted) FarmStep.WEIGH else FarmStep.PRODUCTS) }) {
                        Text(stringResource(R.string.edit), style = MaterialTheme.typography.labelLarge, color = Fresh.primary)
                    }
                }
            }
        }

        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Fresh.primaryTint).padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.total_loaded), style = MaterialTheme.typography.bodyMedium, color = Fresh.primaryStrong)
            Text(
                stringResource(R.string.kg_value, DayLogic.quantity(FarmLogic.loadedKg(draft, state.items).toPlainString())),
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                color = Fresh.primaryStrong,
            )
        }

        FieldCard {
            CheckRow(stringResource(R.string.check_decided), readiness.decided)
            CheckRow(stringResource(R.string.check_weighed), readiness.weighed)
            if (loads) {
                val packer = state.crew.firstOrNull { it.employeeId == draft.packerId }?.name
                val loader = state.crew.firstOrNull { it.employeeId == FarmLogic.loaderOf(draft) }?.name
                CheckRow(
                    if (packer != null && loader != null) stringResource(R.string.check_crew_named, packer, loader) else stringResource(R.string.check_crew),
                    readiness.crew,
                    onFix = { onStep(FarmStep.PACK) }.takeIf { !readiness.crew },
                )
                CheckRow(pluralStringResource(R.plurals.check_photos, draft.loadPhotos, draft.loadPhotos), readiness.photo)
            }
        }
        if (loads) photo(stringResource(if (draft.loadPhotos > 0) R.string.photo_load_another else R.string.photo_load), false, onLoadPhoto)
        if (!state.canBuy) Callout(stringResource(R.string.needs_level_3), Tone.Attention)
    }
}

@Composable
private fun CheckRow(text: String, done: Boolean, onFix: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(24.dp).clip(CircleShape).background(if (done) Fresh.primary else Fresh.surface3),
            contentAlignment = Alignment.Center,
        ) {
            if (done) GlyphIcon(Glyph.Check, Color.White, size = 14.dp)
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = if (done) Fresh.ink else Fresh.inkMuted, modifier = Modifier.weight(1f))
        if (onFix != null) {
            TextButton(onClick = onFix) { Text(stringResource(R.string.choose), style = MaterialTheme.typography.labelLarge, color = Fresh.primary) }
        }
    }
}

// ---------------------------------------------------------------------------
// A completed farm
// ---------------------------------------------------------------------------

@Composable
private fun CompletedFarm(state: FarmUiState, onBack: () -> Unit) {
    val stop = state.stop ?: return
    val outcome: FarmStopOutcomeResponse? = state.outcome
    FieldScreen(
        title = stop.counterpartyName,
        eyebrow = stringResource(R.string.farm_stop_eyebrow, stop.sequenceNumber),
        onBack = onBack,
        headerExtra = {
            Row(Modifier.padding(top = 12.dp)) {
                if (stop.pendingSync) Pill(stringResource(R.string.saving), Tone.Attention)
                else Pill(stringResource(if (stop.status == "completed") R.string.pill_completed else R.string.pill_skipped), Tone.Lime)
            }
        },
    ) {
        if (outcome == null) {
            Callout(stringResource(if (stop.status == "completed") R.string.stop_done else R.string.stop_skipped), if (stop.status == "completed") Tone.Good else Tone.Attention)
            return@FieldScreen
        }
        FieldCard {
            outcome.lines.forEachIndexed { i, line ->
                if (i > 0) HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
                val accepted = line.outcome == "accepted"
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(line.productName, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                        if (!accepted) {
                            Text(
                                listOfNotNull(stringResource(reasonLabel(line.reason)), line.note).joinToString(" — "),
                                style = MaterialTheme.typography.bodySmall,
                                color = Fresh.critical,
                            )
                        } else if (line.sacks != null) {
                            Text(pluralStringResource(R.plurals.n_sacks, line.sacks, line.sacks), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                        }
                    }
                    if (accepted) Text(amount(line.acceptedQuantity, line.uom), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                    else Pill(stringResource(R.string.rejected), Tone.Bad)
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FieldCard(Modifier.weight(1f)) {
                Text(stringResource(R.string.total_loaded), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                Text(stringResource(R.string.kg_value, DayLogic.quantity(outcome.loadedKg)), style = MaterialTheme.typography.titleLarge, color = Fresh.ink)
            }
        }
        if (outcome.packer != null || outcome.loader != null) {
            FieldCard {
                Eyebrow(stringResource(R.string.packing_crew))
                outcome.packer?.let { Text(stringResource(R.string.crew_packer, it.name), style = MaterialTheme.typography.bodyLarge, color = Fresh.ink, modifier = Modifier.padding(top = 6.dp)) }
                outcome.loader?.let { Text(stringResource(R.string.crew_loader, it.name), style = MaterialTheme.typography.bodyLarge, color = Fresh.ink, modifier = Modifier.padding(top = 4.dp)) }
            }
        }
    }
}

/** For the Procurement list: "Loaded 795 kg · 1 rejected". */
@Composable
fun farmSummaryOf(outcome: FarmStopOutcomeResponse): String {
    val rejected = outcome.lines.count { it.outcome == "rejected" }
    val loaded = stringResource(R.string.loaded_kg, DayLogic.quantity(outcome.loadedKg))
    return if (rejected == 0) loaded else "$loaded · ${pluralStringResource(R.plurals.n_rejected, rejected, rejected)}"
}

/** Kilos loaded across the trip's completed farms. */
fun loadedAcross(outcomes: List<FarmStopOutcomeResponse>): BigDecimal =
    outcomes.fold(BigDecimal.ZERO) { sum, o -> sum + (o.loadedKg.toBigDecimalOrNull() ?: BigDecimal.ZERO) }
