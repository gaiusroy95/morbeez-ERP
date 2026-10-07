package com.morbeez.driver.ui.screens.route

import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.ui.components.CarbonHeader
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.LanguagePill
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.RoundIconButton
import com.morbeez.driver.ui.components.Stat
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.theme.Fresh

/**
 * Today's Trip + the Route — the driver's home screen (Driver App
 * Architecture, DRV.19). The route is a timeline with the next stop to do
 * lifted out; an empty active trip shows a clear "nothing assigned yet"
 * state rather than an empty list that looks broken (System Architecture,
 * MOB.4).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RouteScreen(
    onOpenStop: (tripId: String, stopId: String) -> Unit,
    onOpenExpenses: (tripId: String) -> Unit,
    viewModel: RouteViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val trip = state.trip
    val stops = state.stops
    val done = stops.count { it.status != "pending" }
    val next = stops.firstOrNull { it.status == "pending" }
    var reporting by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(Fresh.bg)) {
        CarbonHeader(
            title = stringResource(R.string.route_title),
            eyebrow = trip?.plannedDate ?: stringResource(R.string.field_execution),
            trailing = {
                LanguagePill(onDark = true)
                Spacer(Modifier.width(8.dp))
                RoundIconButton(
                    glyph = Glyph.Sync,
                    description = stringResource(if (state.isSyncing) R.string.syncing else R.string.sync_now),
                    onClick = viewModel::requestSync,
                    enabled = !state.isSyncing,
                )
            },
        ) {
            if (trip != null) {
                // The trips API returns the vehicle's id, not its registration,
                // so no vehicle is shown here until it does.
                FlowRow(
                    Modifier.padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Pill(stringResource(tripStatusLabel(trip.status)), Tone.Lime)
                    authorityLabel(trip.authorityLevel)?.let { (text, waiting) ->
                        Pill(stringResource(text), if (waiting) Tone.Attention else Tone.Neutral, onDark = !waiting)
                    }
                    if (state.isSyncing) Pill(stringResource(R.string.syncing), Tone.Neutral, onDark = true)
                }
                Row(Modifier.fillMaxWidth().padding(top = 18.dp)) {
                    Stat(stringResource(R.string.stops_done), stringResource(R.string.n_of_m, done, stops.size), onDark = true, modifier = Modifier.weight(1f))
                    Stat(stringResource(R.string.advance), stringResource(R.string.rupees, trip.advanceAmount), onDark = true, modifier = Modifier.weight(1f))
                }
                ProgressTrack(if (stops.isEmpty()) 0f else done.toFloat() / stops.size)
                if (trip.status == "in_progress" && !trip.reviewNote.isNullOrBlank()) {
                    Text(
                        stringResource(R.string.returned_by_owner, trip.reviewNote.orEmpty()),
                        style = MaterialTheme.typography.bodyMedium,
                        color = Fresh.accent,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
        }

        if (trip == null) {
            EmptyRoute(syncing = state.isSyncing)
            return@Column
        }

        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 12.dp),
        ) {
            item {
                Eyebrow(pluralStringResource(R.plurals.route_stops, stops.size, stops.size), modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
            }
            itemsIndexed(stops, key = { _, s -> s.id }) { index, stop ->
                StopRow(
                    stop = stop,
                    isNext = stop.id == next?.id,
                    isFirst = index == 0,
                    isLast = index == stops.lastIndex,
                    onClick = { onOpenStop(trip.id, stop.id) },
                )
            }
        }

        Surface(color = Fresh.surface, shadowElevation = 12.dp) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp)) {
                if (next != null) {
                    PrimaryAction(
                        text = stringResource(R.string.next_stop, next.counterpartyName),
                        onClick = { onOpenStop(trip.id, next.id) },
                        glyph = Glyph.Arrow,
                    )
                    Spacer(Modifier.height(10.dp))
                } else if (trip.status == "in_progress") {
                    // Every stop done: hand over the cash and submit.
                    PrimaryAction(text = stringResource(R.string.handover_submit), onClick = { onOpenExpenses(trip.id) }, glyph = Glyph.Rupee)
                    Spacer(Modifier.height(10.dp))
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .clickable(role = Role.Button) { onOpenExpenses(trip.id) }
                        .padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    GlyphIcon(Glyph.Fuel, Fresh.ink, size = 18.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.trip_summary_link), style = MaterialTheme.typography.labelLarge, color = Fresh.ink)
                }
                if (trip.status == "in_progress" || trip.status == "planned") {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .clickable(role = Role.Button) { reporting = true }
                            .padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        GlyphIcon(Glyph.Warning, Fresh.critical, size = 18.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.report_problem), style = MaterialTheme.typography.labelLarge, color = Fresh.critical)
                    }
                }
            }
        }
    }

    if (reporting) {
        ReportProblemDialog(
            onSend = { kind, note ->
                viewModel.reportProblem(kind, note)
                reporting = false
            },
            onDismiss = { reporting = false },
        )
    }
}

/** What the owner has authorized on this trip, as a pill; null when not known yet. */
private fun authorityLabel(level: Int?): Pair<Int, Boolean>? = when (level) {
    null -> null
    0 -> R.string.authority_waiting to true
    1 -> R.string.authority_1 to false
    2 -> R.string.authority_2 to false
    3 -> R.string.authority_3 to false
    else -> R.string.authority_4 to false
}

private val PROBLEM_KINDS = listOf(
    "driver_unable_to_continue" to R.string.problem_cant_continue,
    "trip_blocked" to R.string.problem_blocked,
    "operational_problem" to R.string.problem_other,
    "security" to R.string.problem_security,
)

/** The driver tells the owner something that can't wait (client Q&A, E: Q19). */
@Composable
private fun ReportProblemDialog(onSend: (kind: String, note: String) -> Unit, onDismiss: () -> Unit) {
    var kind by remember { mutableStateOf(PROBLEM_KINDS.first().first) }
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fresh.surface,
        title = { Text(stringResource(R.string.problem_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
        text = {
            Column {
                ChoiceTiles(PROBLEM_KINDS.map { (k, label) -> k to stringResource(label) }, kind) { kind = it }
                Spacer(Modifier.height(14.dp))
                FreshTextField(value = note, onValueChange = { note = it }, label = stringResource(R.string.what_happened), singleLine = false)
                Text(
                    stringResource(R.string.problem_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = Fresh.inkFaint,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSend(kind, note) }, enabled = note.trim().length >= 3) {
                Text(stringResource(R.string.send), color = if (note.trim().length >= 3) Fresh.critical else Fresh.inkFaint)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
    )
}

@Composable
private fun ProgressTrack(fraction: Float) {
    Box(
        Modifier
            .padding(top = 14.dp)
            .fillMaxWidth()
            .height(8.dp)
            .clip(CircleShape)
            .background(Fresh.carbon3),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .clip(CircleShape)
                .background(Fresh.accent),
        )
    }
}

/** One stop on the timeline: a numbered node on a rail, and its card. */
@Composable
private fun StopRow(stop: TripStopEntity, isNext: Boolean, isFirst: Boolean, isLast: Boolean, onClick: () -> Unit) {
    val finished = stop.status != "pending"
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        // The rail
        Box(
            Modifier
                .width(36.dp)
                .fillMaxHeight()
                .drawBehind {
                    // From the node up to the previous stop and down to the next one.
                    val nodeY = 26.dp.toPx()
                    val top = if (isFirst) nodeY else 0f
                    val bottom = if (isLast) nodeY else size.height
                    drawLine(Fresh.borderStrong, Offset(size.width / 2, top), Offset(size.width / 2, bottom), 2.dp.toPx())
                },
            contentAlignment = Alignment.TopCenter,
        ) {
            Box(
                Modifier
                    .padding(top = 12.dp)
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(
                        when {
                            finished -> Fresh.primary
                            isNext -> Fresh.carbon
                            else -> Fresh.surface3
                        },
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (finished) {
                    GlyphIcon(Glyph.Check, Color.White, size = 15.dp)
                } else {
                    Text(
                        "${stop.sequenceNumber}",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (isNext) Fresh.accent else Fresh.inkMuted,
                    )
                }
            }
        }
        Spacer(Modifier.width(8.dp))

        Surface(
            shape = RoundedCornerShape(20.dp),
            color = if (isNext) Fresh.carbon else Fresh.surface,
            border = if (isNext) null else BorderStroke(1.dp, Fresh.border),
            shadowElevation = if (isNext) 8.dp else 1.dp,
            modifier = Modifier.weight(1f).padding(bottom = 10.dp),
        ) {
            Column(Modifier.clickable(role = Role.Button, onClick = onClick).padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    GlyphIcon(
                        if (stop.stopType == "pickup") Glyph.Box else Glyph.Pin,
                        if (isNext) Fresh.accent else Fresh.primary,
                        size = 18.dp,
                    )
                    Spacer(Modifier.width(8.dp))
                    Eyebrow(
                        stringResource(if (stop.stopType == "pickup") R.string.kind_pickup else R.string.kind_delivery),
                        color = if (isNext) Fresh.onCarbonMuted else Fresh.inkMuted,
                        modifier = Modifier.weight(1f),
                    )
                    when {
                        stop.pendingSync -> Pill(stringResource(R.string.saving), Tone.Attention)
                        isNext -> Pill(stringResource(R.string.pill_next), Tone.Lime)
                        stop.status == "completed" -> Pill(stringResource(R.string.pill_done), Tone.Good)
                        stop.status == "skipped" -> Pill(stringResource(R.string.pill_skipped), Tone.Attention)
                    }
                }
                Text(
                    stop.counterpartyName,
                    style = MaterialTheme.typography.titleLarge,
                    color = if (isNext) Fresh.onCarbon else if (finished) Fresh.inkMuted else Fresh.ink,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text(
                    stop.summary,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (isNext) Fresh.onCarbonMuted else Fresh.inkMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
                // What to collect here (requirement: the driver knows "what amount to collect").
                if (stop.stopType == "delivery" && stop.collectTerms != null && !finished) {
                    Text(
                        if (stop.collectTerms == "cash") stringResource(R.string.collect_amount, stop.collectAmount.orEmpty()) else stringResource(R.string.on_credit),
                        style = MaterialTheme.typography.labelLarge,
                        color = if (isNext) Fresh.accent else Fresh.primary,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyRoute(syncing: Boolean) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(72.dp).clip(RoundedCornerShape(24.dp)).background(Fresh.surface3), contentAlignment = Alignment.Center) {
            GlyphIcon(Glyph.Truck, Fresh.inkMuted, size = 34.dp)
        }
        Text(
            stringResource(R.string.no_trip),
            style = MaterialTheme.typography.headlineSmall,
            color = Fresh.ink,
            modifier = Modifier.padding(top = 18.dp),
        )
        Text(
            stringResource(if (syncing) R.string.checking_route else R.string.no_trip_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = Fresh.inkMuted,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

private fun tripStatusLabel(status: String): Int = when (status) {
    "planned" -> R.string.status_planned
    "in_progress" -> R.string.status_in_progress
    "completed" -> R.string.status_completed
    "on_hold" -> R.string.status_on_hold
    "reconciled" -> R.string.status_reconciled
    "cancelled" -> R.string.status_cancelled
    else -> R.string.status_planned
}
