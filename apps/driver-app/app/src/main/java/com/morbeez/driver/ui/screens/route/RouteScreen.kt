package com.morbeez.driver.ui.screens.route

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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

    Column(Modifier.fillMaxSize().background(Fresh.bg)) {
        CarbonHeader(
            title = "Today's route",
            eyebrow = trip?.plannedDate ?: "Field execution",
            trailing = {
                RoundIconButton(
                    glyph = Glyph.Sync,
                    description = if (state.isSyncing) "Syncing" else "Sync now",
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
                    Pill(tripStatusLabel(trip.status), Tone.Lime)
                    if (state.isSyncing) Pill("Syncing…", Tone.Neutral, onDark = true)
                }
                Row(Modifier.fillMaxWidth().padding(top = 18.dp)) {
                    Stat("Stops done", "$done of ${stops.size}", onDark = true, modifier = Modifier.weight(1f))
                    Stat("Advance", "₹${trip.advanceAmount}", onDark = true, modifier = Modifier.weight(1f))
                }
                ProgressTrack(if (stops.isEmpty()) 0f else done.toFloat() / stops.size)
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
                Eyebrow("Route · ${stops.size} stops", modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
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
                        text = "Next: ${next.counterpartyName}",
                        onClick = { onOpenStop(trip.id, next.id) },
                        glyph = Glyph.Arrow,
                    )
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
                    Text("Trip expenses & summary", style = MaterialTheme.typography.labelLarge, color = Fresh.ink)
                }
            }
        }
    }
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
                        if (stop.stopType == "pickup") "Pickup" else "Delivery",
                        color = if (isNext) Fresh.onCarbonMuted else Fresh.inkMuted,
                        modifier = Modifier.weight(1f),
                    )
                    when {
                        stop.pendingSync -> Pill("Saving…", Tone.Attention)
                        isNext -> Pill("Next", Tone.Lime)
                        stop.status == "completed" -> Pill("Done", Tone.Good)
                        stop.status == "skipped" -> Pill("Skipped", Tone.Attention)
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
            "No trip yet",
            style = MaterialTheme.typography.headlineSmall,
            color = Fresh.ink,
            modifier = Modifier.padding(top = 18.dp),
        )
        Text(
            if (syncing) "Checking for your route…" else "When dispatch plans your route it appears here. Tap sync to check now.",
            style = MaterialTheme.typography.bodyMedium,
            color = Fresh.inkMuted,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

private fun tripStatusLabel(status: String) = when (status) {
    "planned" -> "Planned"
    "in_progress" -> "On the road"
    "completed" -> "Completed"
    "reconciled" -> "Reconciled"
    "cancelled" -> "Cancelled"
    else -> status
}
