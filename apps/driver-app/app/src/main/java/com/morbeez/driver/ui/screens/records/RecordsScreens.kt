package com.morbeez.driver.ui.screens.records

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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.BuildConfig
import com.morbeez.driver.R
import com.morbeez.driver.data.i18n.AppLanguage
import com.morbeez.driver.data.remote.dto.ContactResponse
import com.morbeez.driver.data.remote.dto.DriverApprovalResponse
import com.morbeez.driver.data.remote.dto.DriverVehicleResponse
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldIntents
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.LanguageDialog
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.SegmentTabs
import com.morbeez.driver.ui.components.Stat
import com.morbeez.driver.ui.components.TonalAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.expenses.MiniStat
import com.morbeez.driver.ui.screens.expenses.categoryGlyph
import com.morbeez.driver.ui.screens.expenses.categoryLabel
import com.morbeez.driver.ui.screens.expenses.fuelTypeLabel
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.clockOf
import com.morbeez.driver.ui.theme.Fresh

/** "Updated 08:15 AM" — when the server last answered — or that the phone is offline. */
@Composable
private fun UpdatedLine(state: RecordsUiState, onRefresh: () -> Unit) {
    val at = state.refreshedAt?.let { clockOf(it) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            if (!state.online) stringResource(R.string.records_offline, at ?: "—") else stringResource(R.string.records_updated, at ?: "—"),
            style = MaterialTheme.typography.bodySmall,
            color = Fresh.inkFaint,
            modifier = Modifier.weight(1f),
        )
        if (state.online) TonalAction(stringResource(R.string.sync_now), Glyph.Sync, Fresh.surface2, Fresh.primary, onClick = onRefresh)
    }
}

// ---------------------------------------------------------------------------
// Approvals (design sheet 4)
// ---------------------------------------------------------------------------

@Composable
fun ApprovalsScreen(onBack: () -> Unit, viewModel: RecordsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ApprovalsContent(state, onBack, viewModel::refresh)
}

/**
 * Approvals: what the driver raised that the owner decides — an expense
 * beyond their authority, a customer's dispute, a trip handed over — waiting,
 * approved or rejected, with the owner's word. The driver decides nothing here.
 */
@Composable
internal fun ApprovalsContent(state: RecordsUiState, onBack: () -> Unit, onRefresh: () -> Unit) {
    var status by rememberSaveable { mutableStateOf("pending") }
    var kind by rememberSaveable { mutableStateOf("all") }
    val items = state.approvals?.items.orEmpty()
    val counts = state.approvals?.counts
    FieldScreen(
        title = stringResource(R.string.drawer_approvals),
        eyebrow = stringResource(R.string.appr_eyebrow),
        onBack = onBack,
        headerExtra = {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Stat(stringResource(R.string.appr_pending), "${counts?.pending ?: 0}", onDark = true, modifier = Modifier.weight(1f))
                Stat(stringResource(R.string.exp_approved), "${counts?.approved ?: 0}", onDark = true, modifier = Modifier.weight(1f))
                Stat(stringResource(R.string.exp_rejected), "${counts?.rejected ?: 0}", onDark = true, modifier = Modifier.weight(1f))
            }
        },
    ) {
        SegmentTabs(
            listOf(
                "pending" to stringResource(R.string.appr_pending),
                "approved" to stringResource(R.string.exp_approved),
                "rejected" to stringResource(R.string.exp_rejected),
            ),
            status,
            { status = it },
        )
        SegmentTabs(
            listOf(
                "all" to stringResource(R.string.appr_all_n, RecordsLogic.countOf(items, status, "all")),
                "expense" to stringResource(R.string.appr_expenses_n, RecordsLogic.countOf(items, status, "expense")),
                "collection" to stringResource(R.string.appr_collections_n, RecordsLogic.countOf(items, status, "collection")),
                "handover" to stringResource(R.string.appr_other_n, RecordsLogic.countOf(items, status, "handover")),
            ),
            kind,
            { kind = it },
        )
        if (state.approvals == null) Callout(stringResource(R.string.records_not_yet), Tone.Active, Glyph.Sync)
        val shown = RecordsLogic.approvals(items, status, kind)
        if (state.approvals != null && shown.isEmpty()) Text(stringResource(R.string.appr_none), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        shown.forEach { ApprovalCard(it) }
        UpdatedLine(state, onRefresh)
    }
}

@Composable
private fun ApprovalCard(a: DriverApprovalResponse) {
    FieldCard {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Fresh.surface2), contentAlignment = Alignment.Center) {
                GlyphIcon(
                    when (a.kind) {
                        "expense" -> categoryGlyph(a.category)
                        "collection" -> Glyph.Rupee
                        else -> Glyph.Truck
                    },
                    Fresh.primary,
                    size = 20.dp,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    when (a.kind) {
                        "expense" -> stringResource(R.string.appr_expense_title, categoryLabel(a.category))
                        "collection" -> stringResource(R.string.appr_dispute_title, a.customerName ?: "—")
                        else -> stringResource(R.string.appr_handover_title)
                    },
                    style = MaterialTheme.typography.titleMedium,
                    color = Fresh.ink,
                )
                Text(
                    a.amount?.let { stringResource(R.string.rupees, DayLogic.rupees(it)) } ?: "—",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = Fresh.ink,
                )
            }
            when (a.status) {
                "approved" -> Pill(stringResource(R.string.exp_approved), Tone.Good)
                "rejected" -> Pill(stringResource(R.string.exp_rejected), Tone.Bad)
                else -> Pill(stringResource(R.string.appr_pending), Tone.Attention)
            }
        }
        a.detail?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Fresh.ink, modifier = Modifier.padding(top = 8.dp)) }
        val facts = listOfNotNull(
            RecordsFormat.date(a.at)?.let { d -> RecordsFormat.clock(a.at)?.let { "$d · $it" } ?: d },
            a.tripNumber?.let { stringResource(R.string.trip_number, it) },
            a.photos.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.n_photos, it, it) },
        )
        Text(facts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 6.dp))
        ownerWord(a)?.let { (text, tone) ->
            Text(text, style = MaterialTheme.typography.bodyMedium, color = if (tone == Tone.Bad) Fresh.critical else Fresh.primaryStrong, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/** What the owner said, in this item's terms. */
@Composable
private fun ownerWord(a: DriverApprovalResponse): Pair<String, Tone>? = when {
    a.kind == "expense" && a.status == "rejected" -> stringResource(R.string.owner_said, a.note ?: "—") to Tone.Bad
    a.kind == "expense" && a.status == "approved" && a.decidedAt == null -> stringResource(R.string.appr_with_closure) to Tone.Good
    a.kind == "collection" && a.status == "approved" -> stringResource(R.string.appr_settled, a.note ?: "—") to Tone.Good
    a.kind == "collection" && a.status == "rejected" -> stringResource(R.string.appr_withdrawn, a.note ?: "—") to Tone.Bad
    a.kind == "handover" && a.status == "approved" -> stringResource(R.string.appr_closed) to Tone.Good
    a.kind == "handover" && a.status == "rejected" -> stringResource(R.string.appr_sent_back, a.note ?: "—") to Tone.Bad
    a.kind == "handover" && a.note != null -> stringResource(R.string.appr_on_hold, a.note) to Tone.Bad
    else -> null
}

// ---------------------------------------------------------------------------
// Vehicle (design sheet 4)
// ---------------------------------------------------------------------------

@Composable
fun VehicleScreen(onBack: () -> Unit, viewModel: RecordsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    VehicleContent(state, onBack, viewModel::refresh)
}

@Composable
fun docLabel(type: String): String = stringResource(
    when (type) {
        "registration" -> R.string.doc_registration
        "insurance" -> R.string.doc_insurance
        "puc" -> R.string.doc_puc
        "fitness" -> R.string.doc_fitness
        "permit" -> R.string.doc_permit
        "road_tax" -> R.string.doc_road_tax
        else -> R.string.doc_other
    },
)

@Composable
private fun StatePill(state: String) = when (state) {
    "overdue" -> Pill(stringResource(R.string.veh_overdue), Tone.Bad)
    "expired" -> Pill(stringResource(R.string.doc_expired), Tone.Bad)
    "due_soon" -> Pill(stringResource(R.string.veh_due_soon), Tone.Attention)
    "expiring" -> Pill(stringResource(R.string.doc_expiring), Tone.Attention)
    "no_expiry" -> Pill(stringResource(R.string.doc_no_expiry), Tone.Neutral)
    else -> Pill(stringResource(R.string.veh_ok), Tone.Good)
}

/** "1,188 km left"; "23 days"; "5 days over". */
@Composable
private fun leftLabel(kmLeft: Int?, daysLeft: Int?): String? = when {
    kmLeft != null && kmLeft <= 0 -> stringResource(R.string.veh_km_over, DayLogic.quantity("${-kmLeft}"))
    kmLeft != null -> stringResource(R.string.veh_km_left, DayLogic.quantity("$kmLeft"))
    daysLeft != null && daysLeft < 0 -> pluralStringResource(R.plurals.veh_days_over, -daysLeft, -daysLeft)
    daysLeft != null -> pluralStringResource(R.plurals.veh_days_left, daysLeft, daysLeft)
    else -> null
}

/**
 * Vehicle: the one the driver drives — its KM and mileage, what service is
 * next due, its documents in force, and what's due now. Nothing of its
 * books, loans or hire.
 */
@Composable
internal fun VehicleContent(state: RecordsUiState, onBack: () -> Unit, onRefresh: () -> Unit) {
    val v = state.vehicle
    val dues = RecordsLogic.duesOf(v)
    var tab by rememberSaveable { mutableStateOf("overview") }
    FieldScreen(title = stringResource(R.string.drawer_vehicle), eyebrow = v?.registrationNumber, onBack = onBack) {
        if (v == null) {
            Callout(stringResource(R.string.veh_none), Tone.Active, Glyph.Car)
            UpdatedLine(state, onRefresh)
            return@FieldScreen
        }
        SegmentTabs(
            listOf(
                "overview" to stringResource(R.string.veh_tab_overview),
                "maintenance" to stringResource(R.string.veh_tab_maintenance),
                "documents" to stringResource(R.string.veh_tab_documents),
                "dues" to stringResource(R.string.veh_tab_dues, dues.size),
            ),
            tab,
            { tab = it },
        )
        when (tab) {
            "maintenance" -> MaintenanceList(v)
            "documents" -> DocumentList(v)
            "dues" -> DueList(dues)
            else -> VehicleOverview(v, dues.size)
        }
        UpdatedLine(state, onRefresh)
    }
}

@Composable
private fun VehicleOverview(v: DriverVehicleResponse, dueCount: Int) {
    FieldCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(Fresh.primaryTint), contentAlignment = Alignment.Center) {
                GlyphIcon(Glyph.Truck, Fresh.primary, size = 30.dp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(v.registrationNumber, style = MaterialTheme.typography.headlineSmall, color = Fresh.ink)
                Text(
                    listOfNotNull(v.makeModel, v.manufactureYear?.toString()).joinToString(" · ").ifEmpty { "—" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.inkMuted,
                )
                Text(
                    "${fuelTypeLabel(v.fuelType)} · ${stringResource(if (v.ownership == "hired") R.string.veh_hired else R.string.veh_owned)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.inkMuted,
                )
            }
            if (v.fitForTrips) Pill(stringResource(R.string.veh_fit), Tone.Good) else Pill(stringResource(R.string.veh_not_fit), Tone.Bad)
        }
        if (v.issues.isNotEmpty()) {
            v.issues.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = Fresh.warning, modifier = Modifier.padding(top = 6.dp)) }
        }
    }
    FieldCard {
        Row(Modifier.fillMaxWidth()) {
            MiniStat(stringResource(R.string.veh_current_km), v.currentKm?.let { stringResource(R.string.km_value, DayLogic.quantity(it)) } ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.exp_avg_mileage), v.averageKmPerLitre?.let { stringResource(R.string.kmpl_value, it) } ?: "—", Modifier.weight(1f))
            MiniStat(stringResource(R.string.veh_last_tank), v.lastFullTank?.kmPerLitre?.let { stringResource(R.string.kmpl_value, it) } ?: "—", Modifier.weight(1f))
        }
    }
    if (dueCount > 0) Callout(pluralStringResource(R.plurals.veh_dues_callout, dueCount, dueCount), Tone.Attention)
    MaintenanceList(v, limit = 3)
}

@Composable
private fun MaintenanceList(v: DriverVehicleResponse, limit: Int = Int.MAX_VALUE) {
    FieldCard {
        Eyebrow(stringResource(R.string.veh_next_due))
        if (v.maintenance.isEmpty()) Text(stringResource(R.string.veh_no_maintenance), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(top = 8.dp))
        v.maintenance.take(limit).forEachIndexed { i, m ->
            if (i > 0) HorizontalDivider(color = Fresh.border)
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.Wrench, Fresh.primary, size = 20.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.description, style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
                    val last = listOfNotNull(m.lastKm?.let { stringResource(R.string.km_value, DayLogic.quantity("$it")) }, RecordsFormat.date(m.lastDate)).joinToString(" · ")
                    val next = listOfNotNull(m.nextDueKm?.let { stringResource(R.string.km_value, DayLogic.quantity("$it")) }, RecordsFormat.date(m.nextDueDate)).joinToString(" · ")
                    Text(stringResource(R.string.veh_last_next, last, next), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                }
                Column(horizontalAlignment = Alignment.End) {
                    leftLabel(m.kmLeft, m.daysLeft)?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = Fresh.ink) }
                    Box(Modifier.padding(top = 4.dp)) { StatePill(m.state) }
                }
            }
        }
    }
}

@Composable
private fun DocumentList(v: DriverVehicleResponse) {
    FieldCard {
        if (v.documents.isEmpty()) Text(stringResource(R.string.veh_no_documents), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        v.documents.forEachIndexed { i, d ->
            if (i > 0) HorizontalDivider(color = Fresh.border)
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.File, Fresh.primary, size = 20.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(docLabel(d.docType), style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
                    Text(
                        d.validUntil?.let { stringResource(R.string.veh_valid_till, RecordsFormat.date(it) ?: it) } ?: stringResource(R.string.doc_no_expiry),
                        style = MaterialTheme.typography.bodySmall,
                        color = Fresh.inkMuted,
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    leftLabel(null, d.daysLeft)?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = Fresh.ink) }
                    Box(Modifier.padding(top = 4.dp)) { StatePill(d.state) }
                }
            }
        }
    }
}

@Composable
private fun DueList(dues: List<Due>) {
    FieldCard {
        if (dues.isEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.Check, Fresh.primary, size = 20.dp)
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.veh_nothing_due), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink)
            }
        }
        dues.forEachIndexed { i, d ->
            if (i > 0) HorizontalDivider(color = Fresh.border)
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.Warning, if (d.state == "overdue" || d.state == "expired") Fresh.critical else Fresh.warning, size = 20.dp)
                Spacer(Modifier.width(12.dp))
                Text(if (d.kind == "document") docLabel(d.what) else d.what, style = MaterialTheme.typography.titleSmall, color = Fresh.ink, modifier = Modifier.weight(1f))
                leftLabel(d.kmLeft, d.daysLeft)?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = if (d.state == "overdue" || d.state == "expired") Fresh.critical else Fresh.warning) }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Profile and Help (side drawer)
// ---------------------------------------------------------------------------

@Composable
fun ProfileScreen(onBack: () -> Unit, viewModel: RecordsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ProfileContent(state, onBack, viewModel::refresh)
}

/** Who the driver is, the vehicle they drive, the language, and who to call at the business. */
@Composable
internal fun ProfileContent(state: RecordsUiState, onBack: () -> Unit, onRefresh: () -> Unit) {
    val context = LocalContext.current
    val p = state.profile
    var choosingLanguage by rememberSaveable { mutableStateOf(false) }
    val name = p?.name ?: state.day?.driverName
    FieldScreen(title = stringResource(R.string.drawer_profile), onBack = onBack) {
        FieldCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(60.dp).clip(CircleShape).background(Fresh.primaryTint), contentAlignment = Alignment.Center) {
                    val initials = DayLogic.initialsOf(name)
                    if (initials.isEmpty()) GlyphIcon(Glyph.User, Fresh.primary, size = 28.dp) else Text(initials, style = MaterialTheme.typography.headlineSmall, color = Fresh.primaryStrong)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(name ?: stringResource(R.string.driver), style = MaterialTheme.typography.titleLarge, color = Fresh.ink)
                    RecordsLogic.phone(p?.phone)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted) }
                }
                Pill(stringResource(R.string.driver), Tone.Good)
            }
        }
        FieldCard {
            InfoRow(stringResource(R.string.prof_business), p?.businessName?.ifBlank { null } ?: "—")
            InfoRow(stringResource(R.string.drawer_vehicle), p?.vehicle ?: state.day?.vehicleRegistration ?: "—")
            p?.joinedOn?.let { InfoRow(stringResource(R.string.prof_joined), RecordsFormat.date(it) ?: it) }
            val code = runCatching { AppLanguage.current(context) }.getOrDefault("en")
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.language), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.weight(1f))
                TonalAction(AppLanguage.CHOICES.firstOrNull { it.first == code }?.second ?: code, Glyph.Globe, Fresh.surface2, Fresh.primary) { choosingLanguage = true }
            }
        }
        Contacts(p?.contacts.orEmpty())
        if (p == null) Callout(stringResource(R.string.records_not_yet), Tone.Active, Glyph.Sync)
        UpdatedLine(state, onRefresh)
    }
    if (choosingLanguage) LanguageDialog(onDismiss = { choosingLanguage = false })
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
    }
}

/** Who to call at the business: its owners. */
@Composable
private fun Contacts(contacts: List<ContactResponse>) {
    if (contacts.isEmpty()) return
    val context = LocalContext.current
    FieldCard {
        Eyebrow(stringResource(R.string.prof_call_office))
        contacts.forEach { c ->
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    // An owner with no worker record is known by their login: say "Owner", not the number twice.
                    Text(if (c.name == c.phone) stringResource(R.string.prof_owner) else c.name, style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
                    Text(RecordsLogic.phone(c.phone) ?: c.phone, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                }
                TonalAction(stringResource(R.string.call), Glyph.Phone, Fresh.primaryTint, Fresh.primaryStrong) { FieldIntents.dial(context, c.phone) }
            }
        }
    }
}

@Composable
fun HelpScreen(onBack: () -> Unit, onOpenSync: () -> Unit, viewModel: RecordsViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    HelpContent(state, onBack, onOpenSync)
}

/** How the app works on the road, in a few answers, and who to call. */
@Composable
internal fun HelpContent(state: RecordsUiState, onBack: () -> Unit, onOpenSync: () -> Unit) {
    FieldScreen(title = stringResource(R.string.drawer_help), onBack = onBack) {
        listOf(
            R.string.help_offline_q to R.string.help_offline_a,
            R.string.help_hold_q to R.string.help_hold_a,
            R.string.help_expense_q to R.string.help_expense_a,
            R.string.help_approvals_q to R.string.help_approvals_a,
            R.string.help_wrong_q to R.string.help_wrong_a,
        ).forEach { (q, a) ->
            FieldCard {
                Text(stringResource(q), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                Text(stringResource(a), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(top = 6.dp))
            }
        }
        SecondaryAction(stringResource(R.string.help_open_sync), onOpenSync, glyph = Glyph.Sync)
        Contacts(state.profile?.contacts.orEmpty())
        Text(stringResource(R.string.version, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
    }
}

