package com.morbeez.driver.ui.screens.home

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.data.remote.dto.TripVehicleStockResponse
import com.morbeez.driver.ui.screens.farm.farmSummaryOf
import com.morbeez.driver.ui.screens.deliver.DeliveryLogic
import com.morbeez.driver.ui.screens.deliver.leftOnVehicle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.screens.farm.loadedAcross
import com.morbeez.driver.data.repository.LogoutResult
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldIntents
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.RoundIconButton
import com.morbeez.driver.ui.components.TonalAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.components.drawGlow
import com.morbeez.driver.ui.theme.Fresh
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

enum class HomeTab { DASHBOARD, PROCUREMENT, DELIVERY }

/**
 * The driver app's shell (Driver app V1, D1; client spec §1): a status
 * header (trip, online / offline / syncing), the Dashboard, Procurement and
 * Delivery tabs on a bottom bar, and the side drawer.
 */
@Composable
fun HomeScreen(
    onStartDay: () -> Unit,
    onOpenStop: (tripId: String, stopId: String, isPickup: Boolean) -> Unit,
    onOpenTrip: () -> Unit,
    onOpenExpenses: (tripId: String) -> Unit,
    onOpenSync: () -> Unit,
    onOpenVehicleStock: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(HomeTab.DASHBOARD) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.trip?.status) { viewModel.refreshPosition() }

    // A trip the owner planned for today opens Start Day once, as the day's first screen.
    var offeredStart by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(state.trip?.id, state.trip?.status) {
        val trip = state.trip
        if (trip?.status == "planned" && offeredStart != trip.id) {
            offeredStart = trip.id
            onStartDay()
        }
    }

    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(enabled = !drawer.isOpen && tab != HomeTab.DASHBOARD) { tab = HomeTab.DASHBOARD }

    HomeShell(
        state = state,
        tab = tab,
        onTab = { tab = it },
        drawer = drawer,
        onStartDay = onStartDay,
        onOpenStop = onOpenStop,
        onOpenTrip = onOpenTrip,
        onOpenExpenses = onOpenExpenses,
        onOpenSync = onOpenSync,
        onOpenVehicleStock = onOpenVehicleStock,
        onStartDeliveries = viewModel::startDeliveries,
        onSync = viewModel::requestSync,
        onSignOut = viewModel::signOut,
        onSignedOut = onSignedOut,
    )
}

/** The shell itself, from state alone (the screenshot tests draw it with sample days). */
@Composable
internal fun HomeShell(
    state: HomeUiState,
    tab: HomeTab,
    onTab: (HomeTab) -> Unit,
    drawer: DrawerState,
    onStartDay: () -> Unit,
    onOpenStop: (tripId: String, stopId: String, isPickup: Boolean) -> Unit,
    onOpenTrip: () -> Unit,
    onOpenExpenses: (tripId: String) -> Unit,
    onOpenSync: () -> Unit,
    onSync: () -> Unit,
    onSignOut: (discardUnsynced: Boolean, onResult: (LogoutResult) -> Unit) -> Unit,
    onSignedOut: () -> Unit,
    onOpenVehicleStock: () -> Unit = {},
    onStartDeliveries: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            DriverDrawer(
                state = state,
                onNavigate = { open ->
                    scope.launch { drawer.close() }
                    open()
                },
                onOpenExpenses = onOpenExpenses,
                onOpenTrip = onOpenTrip,
                onOpenSync = onOpenSync,
                onSync = onSync,
                onSignOut = onSignOut,
                onSignedOut = onSignedOut,
            )
        },
    ) {
        Column(Modifier.fillMaxSize().background(Fresh.bg)) {
            StatusHeader(
                state = state,
                onMenu = { scope.launch { drawer.open() } },
                onSync = onSync,
                onOpenSync = onOpenSync,
            )
            Box(Modifier.weight(1f)) {
                when (tab) {
                    HomeTab.DASHBOARD -> DashboardTab(
                        state = state,
                        onStartDay = onStartDay,
                        onOpenStop = onOpenStop,
                        onOpenExpenses = onOpenExpenses,
                        onTab = onTab,
                        onSync = onSync,
                        onOpenSync = onOpenSync,
                        onOpenVehicleStock = onOpenVehicleStock,
                    )
                    HomeTab.PROCUREMENT -> StopsTab(state, "pickup", onOpenStop, onStartDay, onOpenVehicleStock, onStartDeliveries)
                    HomeTab.DELIVERY -> StopsTab(state, "delivery", onOpenStop, onStartDay, onOpenVehicleStock, onStartDeliveries)
                }
            }
            BottomTabs(tab, state.stops, onSelect = onTab)
        }
    }
}

// ---------------------------------------------------------------------------
// Status header
// ---------------------------------------------------------------------------

@Composable
private fun StatusHeader(state: HomeUiState, onMenu: () -> Unit, onSync: () -> Unit, onOpenSync: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Fresh.carbon)
            .drawBehind { drawGlow() }
            .statusBarsPadding()
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RoundIconButton(Glyph.Menu, stringResource(R.string.menu), onMenu)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                state.trip?.number ?: stringResource(R.string.app_name),
                style = MaterialTheme.typography.titleLarge,
                color = Fresh.onCarbon,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            LinkLine(state.link)
        }
        if (state.link.failed > 0) {
            Box(
                Modifier
                    .padding(end = 8.dp)
                    .clip(CircleShape)
                    .background(Fresh.warningBright)
                    .clickable(role = Role.Button, onClick = onOpenSync)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            ) {
                Text(pluralStringResource(R.plurals.stuck, state.link.failed, state.link.failed), style = MaterialTheme.typography.labelMedium, color = Fresh.accentInk)
            }
        }
        RoundIconButton(
            glyph = Glyph.Sync,
            description = stringResource(if (state.link.syncing) R.string.syncing else R.string.sync_now),
            onClick = onSync,
            enabled = !state.link.syncing,
        )
    }
}

/** "● Online", "● Offline · 3 saved on this phone", "● Syncing…". */
@Composable
fun LinkLine(link: LinkState, onDark: Boolean = true) {
    val (dot, text) = when {
        link.syncing -> Fresh.accent to stringResource(R.string.syncing)
        !link.online && link.waiting > 0 -> Fresh.warningBright to pluralStringResource(R.plurals.offline_waiting, link.waiting, link.waiting)
        !link.online -> Fresh.warningBright to stringResource(R.string.offline)
        link.waiting > 0 -> Fresh.accent to pluralStringResource(R.plurals.online_waiting, link.waiting, link.waiting)
        else -> Fresh.accent to stringResource(R.string.online)
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (onDark) dot else if (dot == Fresh.accent) Fresh.good else Fresh.warning))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = if (onDark) Fresh.onCarbonMuted else Fresh.inkMuted)
    }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

@Composable
private fun DashboardTab(
    state: HomeUiState,
    onStartDay: () -> Unit,
    onOpenStop: (String, String, Boolean) -> Unit,
    onOpenExpenses: (String) -> Unit,
    onTab: (HomeTab) -> Unit,
    onSync: () -> Unit,
    onOpenSync: () -> Unit,
    onOpenVehicleStock: () -> Unit,
) {
    val trip = state.trip
    val stops = state.stops
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        GreetingCard(state)
        NextActionCard(state, DayLogic.nextActionOf(trip, stops), onStartDay, onOpenStop, onOpenExpenses, onSync)
        if (state.link.failed > 0) {
            Box(Modifier.clip(RoundedCornerShape(14.dp)).clickable(role = Role.Button, onClick = onOpenSync)) {
                Callout(pluralStringResource(R.plurals.failed_ops, state.link.failed, state.link.failed), Tone.Bad)
            }
        }
        if (trip != null) {
            val pick = DayLogic.progressOf(stops, "pickup")
            val drop = DayLogic.progressOf(stops, "delivery")
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Tile(Glyph.Box, Fresh.warningTint, Fresh.warning, stringResource(R.string.tab_procurement), stringResource(R.string.done_of, pick.done, pick.total), Modifier.weight(1f)) { onTab(HomeTab.PROCUREMENT) }
                Tile(Glyph.Truck, Fresh.primaryTint, Fresh.primary, stringResource(R.string.tab_delivery), stringResource(R.string.done_of, drop.done, drop.total), Modifier.weight(1f)) { onTab(HomeTab.DELIVERY) }
            }
        }
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val earned = state.day?.earnedThisWeek
            Tile(Glyph.Rupee, Fresh.infoTint, Fresh.info, stringResource(R.string.tile_earned), if (earned == null) "—" else stringResource(R.string.rupees, DayLogic.rupees(earned)), Modifier.weight(1f))
            // The phone's reckoning: the server's last count and what's been done since.
            val onVehicle = if (state.stock == null && state.stockLines.isEmpty()) null else leftOnVehicle(state.stockLines).toPlainString()
            Tile(
                Glyph.Box,
                Fresh.primaryTint,
                Fresh.primaryStrong,
                stringResource(R.string.tile_stock),
                if (onVehicle == null) "—" else stringResource(R.string.kg_value, DayLogic.quantity(onVehicle)),
                Modifier.weight(1f),
                onClick = if (trip != null) onOpenVehicleStock else null,
            )
        }
        state.stock?.takeIf { it.rows.isNotEmpty() }?.let { StockCard(it, state.day?.refreshedAt) }
    }
}

@Composable
private fun GreetingCard(state: HomeUiState) {
    val name = state.day?.driverName
    FieldCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(52.dp).clip(CircleShape).background(Fresh.carbon), contentAlignment = Alignment.Center) {
                val initials = DayLogic.initialsOf(name)
                if (initials.isEmpty()) GlyphIcon(Glyph.User, Fresh.accent, size = 24.dp)
                else Text(initials, style = MaterialTheme.typography.titleLarge, color = Fresh.accent)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(
                        when (DayLogic.greetingAt(LocalTime.now().hour)) {
                            Greeting.MORNING -> R.string.greeting_morning
                            Greeting.AFTERNOON -> R.string.greeting_afternoon
                            Greeting.EVENING -> R.string.greeting_evening
                        },
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.inkMuted,
                )
                Text(name ?: stringResource(R.string.driver), style = MaterialTheme.typography.headlineSmall, color = Fresh.ink)
            }
        }
        val vehicle = state.day?.vehicleRegistration ?: state.trip?.vehicleRegistrationNumber
        if (vehicle != null) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 12.dp)) {
                GlyphIcon(Glyph.Truck, Fresh.primary, size = 18.dp)
                Spacer(Modifier.width(8.dp))
                Text(
                    listOfNotNull(stringResource(R.string.vehicle_line, vehicle), state.day?.routeName).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.ink,
                )
            }
        }
        DayLogic.stepOf(state.trip, state.stops)?.let { StepTracker(it) }
    }
}

@Composable
private fun StepTracker(step: DayStep) {
    val labels = listOf(R.string.step_start, R.string.step_pick, R.string.step_deliver, R.string.step_summary, R.string.step_complete)
    Row(Modifier.fillMaxWidth().padding(top = 16.dp)) {
        labels.forEachIndexed { i, label ->
            val done = i < step.ordinal
            val current = i == step.ordinal
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(28.dp)
                        .drawBehind {
                            val y = size.height / 2
                            val w = 2.dp.toPx()
                            if (i > 0) drawLine(if (i <= step.ordinal) Fresh.primary else Fresh.border, Offset(0f, y), Offset(size.width / 2, y), w)
                            if (i < labels.lastIndex) drawLine(if (i < step.ordinal) Fresh.primary else Fresh.border, Offset(size.width / 2, y), Offset(size.width, y), w)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(if (done) Fresh.primary else if (current) Fresh.carbon else Fresh.surface3),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (done) {
                            GlyphIcon(Glyph.Check, Color.White, size = 14.dp)
                        } else {
                            Text("${i + 1}", style = MaterialTheme.typography.labelMedium, color = if (current) Fresh.accent else Fresh.inkMuted)
                        }
                    }
                }
                Text(
                    stringResource(label),
                    style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp),
                    color = if (current) Fresh.ink else Fresh.inkMuted,
                    maxLines = 2,
                    textAlign = TextAlign.Center,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 6.dp, start = 1.dp, end = 1.dp),
                )
            }
        }
    }
}

@Composable
private fun NextActionCard(
    state: HomeUiState,
    action: NextAction,
    onStartDay: () -> Unit,
    onOpenStop: (String, String, Boolean) -> Unit,
    onOpenExpenses: (String) -> Unit,
    onSync: () -> Unit,
) {
    val trip = state.trip
    val goTo = action as? NextAction.GoTo
    Surface(
        shape = MaterialTheme.shapes.large,
        color = Fresh.carbon,
        shadowElevation = 8.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier
                .then(if (goTo != null && trip != null) Modifier.clickable(role = Role.Button) { onOpenStop(trip.id, goTo.stop.id, goTo.stop.stopType == "pickup") } else Modifier)
                .drawBehind { drawGlow() }
                .padding(18.dp),
        ) {
            Eyebrow(stringResource(R.string.next_action), color = Fresh.onCarbonMuted)
            when (action) {
                NextAction.NoTrip -> {
                    CardTitle(stringResource(R.string.no_trip_today))
                    CardBody(stringResource(R.string.no_trip_today_hint))
                    DarkButton(stringResource(R.string.check_again), Glyph.Sync, onSync, Modifier.padding(top = 14.dp).fillMaxWidth(), emphasized = false)
                }
                NextAction.StartDay -> {
                    CardTitle(stringResource(R.string.start_your_day))
                    val vehicle = state.day?.vehicleRegistration ?: trip?.vehicleRegistrationNumber.orEmpty()
                    CardBody(pluralStringResource(R.plurals.start_day_stops, state.stops.size, vehicle, state.stops.size))
                    DarkButton(stringResource(R.string.start_day), Glyph.Chevrons, onStartDay, Modifier.padding(top = 14.dp).fillMaxWidth())
                }
                is NextAction.GoTo -> NextStopBody(state, action.stop)
                NextAction.Handover -> {
                    CardTitle(stringResource(R.string.all_stops_done))
                    CardBody(stringResource(R.string.all_stops_done_hint))
                    if (trip != null) DarkButton(stringResource(R.string.handover_submit), Glyph.Rupee, { onOpenExpenses(trip.id) }, Modifier.padding(top = 14.dp).fillMaxWidth())
                }
                NextAction.AwaitingOwner -> {
                    CardTitle(stringResource(R.string.status_completed))
                    val cash = trip?.cashDeclared
                    CardBody(if (cash != null) stringResource(R.string.submitted_callout_cash, DayLogic.rupees(cash)) else stringResource(R.string.submitted_callout))
                }
                is NextAction.OnHold -> {
                    CardTitle(stringResource(R.string.status_on_hold))
                    CardBody(stringResource(R.string.on_hold_callout, action.note ?: stringResource(R.string.checking_it)))
                }
            }
            if (trip?.status == "in_progress" && !trip.reviewNote.isNullOrBlank()) {
                Text(
                    stringResource(R.string.returned_by_owner, trip.reviewNote.orEmpty()),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.accent,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun NextStopBody(state: HomeUiState, stop: TripStopEntity) {
    val context = LocalContext.current
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
        Pill(stringResource(if (stop.stopType == "pickup") R.string.kind_pickup else R.string.kind_delivery), Tone.Lime)
        DayLogic.etaTo(state.position?.latitude, state.position?.longitude, stop)?.let { eta ->
            Spacer(Modifier.width(10.dp))
            GlyphIcon(Glyph.Pin, Fresh.accent, size = 16.dp)
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.eta, DayLogic.kmLabel(eta.km), eta.minutes), style = MaterialTheme.typography.labelLarge, color = Fresh.onCarbon)
        }
    }
    CardTitle(stop.counterpartyName)
    CardBody(stop.summary)
    val where = stop.partyAddress ?: stop.partyPlace
    if (where != null) {
        Text(where, style = MaterialTheme.typography.bodySmall, color = Fresh.onCarbonFaint, modifier = Modifier.padding(top = 4.dp))
    }
    if (stop.stopType == "delivery" && stop.collectTerms != null) {
        Text(
            if (stop.collectTerms == "cash") stringResource(R.string.collect_amount, DayLogic.rupees(stop.collectAmount)) else stringResource(R.string.on_credit),
            style = MaterialTheme.typography.labelLarge,
            color = Fresh.accent,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
    Row(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        DarkButton(
            stringResource(R.string.call),
            Glyph.Phone,
            { stop.partyPhone?.let { FieldIntents.dial(context, it) } },
            Modifier.weight(1f),
            emphasized = false,
            enabled = stop.partyPhone != null,
        )
        DarkButton(
            stringResource(R.string.navigate),
            Glyph.Navigate,
            {
                val opened = FieldIntents.navigate(context, stop.partyLatitude, stop.partyLongitude, stop.counterpartyName, stop.partyAddress ?: stop.partyPlace)
                if (!opened) Toast.makeText(context, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
            },
            Modifier.weight(1f),
            enabled = stop.partyLatitude != null || stop.partyAddress != null || stop.partyPlace != null,
        )
    }
}

@Composable
private fun CardTitle(text: String) {
    Text(text, style = MaterialTheme.typography.headlineSmall, color = Fresh.onCarbon, modifier = Modifier.padding(top = 8.dp))
}

@Composable
private fun CardBody(text: String) {
    if (text.isBlank()) return
    Text(text, style = MaterialTheme.typography.bodyMedium, color = Fresh.onCarbonMuted, modifier = Modifier.padding(top = 4.dp))
}

/** A button on the green frame: lime when it's the thing to do, a quieter green otherwise. */
@Composable
private fun DarkButton(
    text: String,
    glyph: Glyph,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    emphasized: Boolean = true,
    enabled: Boolean = true,
) {
    val fg = when {
        !enabled -> Fresh.onCarbonFaint
        emphasized -> Fresh.accentInk
        else -> Fresh.onCarbon
    }
    // Labels run longer in Malayalam, Kannada and Tamil: they wrap rather than lose words.
    Row(
        modifier
            .heightIn(min = 50.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (emphasized && enabled) Fresh.accent else Fresh.carbon3)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlyphIcon(glyph, fg, size = 18.dp)
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, color = fg, maxLines = 2, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Tile(
    glyph: Glyph,
    tint: Color,
    ink: Color,
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = Fresh.surface,
        border = BorderStroke(1.dp, Fresh.border),
        shadowElevation = 1.dp,
        modifier = modifier.fillMaxHeight(),
    ) {
        Column(
            Modifier
                .fillMaxHeight()
                .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
                .padding(14.dp),
        ) {
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(tint), contentAlignment = Alignment.Center) {
                GlyphIcon(glyph, ink, size = 20.dp)
            }
            Text(label, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 10.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.weight(1f))
            Text(
                value,
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                color = Fresh.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/** What's on the vehicle, product by product, as the server last said. */
@Composable
private fun StockCard(stock: TripVehicleStockResponse, refreshedAt: Long?) {
    FieldCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow(stringResource(R.string.on_the_vehicle, stock.registrationNumber), modifier = Modifier.weight(1f))
            stock.totalsKg?.let { Text(stringResource(R.string.kg_value, DayLogic.quantity(it.onVehicle)), style = MaterialTheme.typography.titleMedium, color = Fresh.primary) }
        }
        stock.rows.forEach { row ->
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(row.product, style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
                    if (row.toDeliver.toBigDecimalOrNull()?.signum() == 1) {
                        Text(
                            stringResource(R.string.stock_to_deliver, "${DayLogic.quantity(row.toDeliver)} ${row.uom}"),
                            style = MaterialTheme.typography.bodySmall,
                            color = Fresh.inkMuted,
                        )
                    }
                }
                if (row.short.toBigDecimalOrNull()?.signum() == 1) {
                    Pill(stringResource(R.string.stock_short, "${DayLogic.quantity(row.short)} ${row.uom}"), Tone.Attention)
                    Spacer(Modifier.width(8.dp))
                }
                Text("${DayLogic.quantity(row.onVehicle)} ${row.uom}", style = MaterialTheme.typography.titleSmall, color = Fresh.ink)
            }
        }
        if (refreshedAt != null) {
            Text(
                stringResource(R.string.stock_as_of, clockOf(refreshedAt)),
                style = MaterialTheme.typography.bodySmall,
                color = Fresh.inkFaint,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

/** Every farm visited: the kilos loaded across them. */
@Composable
private fun ProcurementComplete(farms: List<FarmStopOutcomeResponse>, count: Int) {
    FieldCard(highlight = true) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(Fresh.primary), contentAlignment = Alignment.Center) {
                GlyphIcon(Glyph.Check, Color.White, size = 20.dp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.procurement_complete), style = MaterialTheme.typography.titleLarge, color = Fresh.ink)
                Text(pluralStringResource(R.plurals.farms_visited, count, count), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(stringResource(R.string.total_loaded), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted)
                Text(stringResource(R.string.kg_value, DayLogic.quantity(loadedAcross(farms).toPlainString())), style = MaterialTheme.typography.titleLarge, color = Fresh.primary)
            }
        }
    }
}

/** "10:42", on this phone's clock. */
fun clockOf(epochMillis: Long): String =
    DateTimeFormatter.ofPattern("HH:mm").format(Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()))

// ---------------------------------------------------------------------------
// Procurement and Delivery
// ---------------------------------------------------------------------------

private enum class StopFilter { ALL, PENDING, DONE }

/** The farms to visit (Procurement) or the customers to deliver to (Delivery), in visiting order. */
@Composable
private fun StopsTab(
    state: HomeUiState,
    stopType: String,
    onOpenStop: (String, String, Boolean) -> Unit,
    onStartDay: () -> Unit,
    onOpenVehicleStock: () -> Unit,
    onStartDeliveries: () -> Unit,
) {
    val trip = state.trip
    val all = state.stops.filter { it.stopType == stopType }.sortedBy { it.sequenceNumber }
    var filter by rememberSaveable(stopType) { mutableStateOf(StopFilter.ALL) }
    val pending = all.filterNot(DayLogic::isDone)
    val done = all.filter(DayLogic::isDone)
    val shown = when (filter) {
        StopFilter.ALL -> all
        StopFilter.PENDING -> pending
        StopFilter.DONE -> done
    }
    val next = DayLogic.nextStop(state.stops)
    // Deliveries go one at a time, in order, once the delivery run has set off (client spec §11).
    val nextDelivery = DeliveryLogic.nextDelivery(state.stops)
    val deliveriesOpen = trip?.status == "in_progress" && trip.deliveryStartedAt != null
    var confirmStart by rememberSaveable { mutableStateOf(false) }
    val farmsLeft = state.stops.count { it.stopType == "pickup" && !DayLogic.isDone(it) }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                stringResource(if (stopType == "pickup") R.string.procurement_count else R.string.delivery_count, all.size),
                style = MaterialTheme.typography.headlineSmall,
                color = Fresh.ink,
            )
            LazyRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(stringResource(R.string.filter_all, all.size), filter == StopFilter.ALL) { filter = StopFilter.ALL } }
                item { FilterChip(stringResource(R.string.filter_pending, pending.size), filter == StopFilter.PENDING) { filter = StopFilter.PENDING } }
                item { FilterChip(stringResource(R.string.filter_completed, done.size), filter == StopFilter.DONE) { filter = StopFilter.DONE } }
            }
        }
        if (trip?.status == "planned") {
            item {
                Box(Modifier.clip(RoundedCornerShape(14.dp)).clickable(role = Role.Button, onClick = onStartDay)) {
                    Callout(stringResource(R.string.start_day_first), Tone.Attention)
                }
            }
        }
        if (stopType == "delivery" && trip?.status == "in_progress") {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TonalAction(stringResource(R.string.tile_stock), Glyph.Box, Fresh.surface, Fresh.primary, Modifier.weight(1f), onClick = onOpenVehicleStock)
                }
            }
            if (!deliveriesOpen && pending.isNotEmpty()) {
                item {
                    PrimaryAction(stringResource(R.string.start_trip), { if (farmsLeft > 0) confirmStart = true else onStartDeliveries() }, glyph = Glyph.Truck)
                }
            }
            if (all.isNotEmpty() && pending.isEmpty()) {
                item {
                    val left = leftOnVehicle(state.stockLines)
                    if (left.signum() > 0) Callout(stringResource(R.string.stock_left_over, DayLogic.quantity(left.toPlainString())), Tone.Attention)
                    else Callout(stringResource(R.string.vehicle_empty), Tone.Good, Glyph.Check)
                }
            }
        }
        // Every farm done: what's on the vehicle now (design sheet: procurement complete with vehicle stock).
        if (stopType == "pickup" && all.isNotEmpty() && pending.isEmpty()) {
            item { ProcurementComplete(all.mapNotNull { state.farms[it.id] }, all.size) }
            state.stock?.takeIf { it.rows.isNotEmpty() }?.let { stock -> item { StockCard(stock, state.day?.refreshedAt) } }
        }
        if (trip == null) {
            item { Callout(stringResource(R.string.no_trip_today_hint), Tone.Active) }
        } else if (shown.isEmpty()) {
            item { Text(stringResource(R.string.no_stops_here), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(4.dp)) }
        }
        itemsIndexed(shown, key = { _, s -> s.id }) { _, stop ->
            StopCard(
                stop = stop,
                number = all.indexOf(stop) + 1,
                isNext = stop.id == next?.id && trip?.status == "in_progress",
                position = state.position,
                farm = state.farms[stop.id],
                locked = stop.stopType == "delivery" && !DayLogic.isDone(stop) && (!deliveriesOpen || stop.id != nextDelivery?.id),
                onOpen = { if (trip != null) onOpenStop(trip.id, stop.id, stop.stopType == "pickup") },
            )
        }
    }
    if (confirmStart) {
        AlertDialog(
            onDismissRequest = { confirmStart = false },
            containerColor = Fresh.surface,
            title = { Text(stringResource(R.string.start_trip_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = { Text(pluralStringResource(R.plurals.farms_left, farmsLeft, farmsLeft), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted) },
            confirmButton = {
                TextButton(onClick = {
                    confirmStart = false
                    onStartDeliveries()
                }) { Text(stringResource(R.string.start_trip), color = Fresh.primary) }
            },
            dismissButton = { TextButton(onClick = { confirmStart = false }) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
        )
    }
}

@Composable
private fun FilterChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(if (selected) Fresh.carbon else Fresh.surface)
            .border(1.dp, if (selected) Fresh.carbon else Fresh.borderStrong, CircleShape)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (selected) Fresh.onCarbon else Fresh.ink)
    }
}

@Composable
private fun StopCard(
    stop: TripStopEntity,
    number: Int,
    isNext: Boolean,
    position: com.morbeez.driver.data.device.Position?,
    farm: FarmStopOutcomeResponse? = null,
    locked: Boolean = false,
    onOpen: () -> Unit,
) {
    val context = LocalContext.current
    val finished = DayLogic.isDone(stop)
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = Fresh.surface,
        border = BorderStroke(if (isNext) 1.5.dp else 1.dp, if (isNext) Fresh.primary else Fresh.border),
        shadowElevation = if (isNext) 6.dp else 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.clickable(role = Role.Button, onClick = onOpen).padding(16.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    Modifier.size(34.dp).clip(CircleShape).background(if (finished) Fresh.primary else Fresh.primaryTint),
                    contentAlignment = Alignment.Center,
                ) {
                    if (finished) GlyphIcon(Glyph.Check, Color.White, size = 16.dp)
                    else Text("$number", style = MaterialTheme.typography.titleSmall, color = Fresh.primaryStrong)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(stop.counterpartyName, style = MaterialTheme.typography.titleMedium, color = if (finished) Fresh.inkMuted else Fresh.ink)
                    val eta = DayLogic.etaTo(position?.latitude, position?.longitude, stop)
                    val meta = listOfNotNull(
                        stop.partyPlace,
                        eta?.let { stringResource(R.string.eta, DayLogic.kmLabel(it.km), it.minutes) },
                    ).joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 2.dp))
                }
                Spacer(Modifier.width(8.dp))
                when {
                    stop.pendingSync -> Pill(stringResource(R.string.saving), Tone.Attention)
                    locked -> Pill(stringResource(R.string.locked), Tone.Neutral)
                    isNext -> Pill(stringResource(R.string.pill_next), Tone.Lime)
                    stop.status == "completed" -> Pill(stringResource(R.string.pill_done), Tone.Good)
                    stop.status == "skipped" -> Pill(stringResource(R.string.pill_skipped), Tone.Attention)
                    else -> Pill(stringResource(R.string.pill_to_do), Tone.Neutral)
                }
            }
            Text(
                stop.summary,
                style = MaterialTheme.typography.bodyMedium,
                color = Fresh.inkMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 10.dp),
            )
            if (farm != null) {
                Text(farmSummaryOf(farm), style = MaterialTheme.typography.labelLarge, color = Fresh.primary, modifier = Modifier.padding(top = 6.dp))
            }
            if (stop.stopType == "delivery" && stop.collectTerms != null && !finished) {
                Text(
                    if (stop.collectTerms == "cash") stringResource(R.string.collect_amount, DayLogic.rupees(stop.collectAmount)) else stringResource(R.string.on_credit),
                    style = MaterialTheme.typography.labelLarge,
                    color = Fresh.primary,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            if (!finished) {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TonalAction(stringResource(R.string.call), Glyph.Phone, Fresh.surface2, Fresh.primary, Modifier.weight(1f), enabled = stop.partyPhone != null) {
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
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Bottom bar
// ---------------------------------------------------------------------------

@Composable
private fun BottomTabs(tab: HomeTab, stops: List<TripStopEntity>, onSelect: (HomeTab) -> Unit) {
    Surface(color = Fresh.surface, shadowElevation = 12.dp) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 8.dp, vertical = 6.dp)) {
            TabItem(Glyph.Home, R.string.tab_dashboard, tab == HomeTab.DASHBOARD, null) { onSelect(HomeTab.DASHBOARD) }
            TabItem(Glyph.Box, R.string.tab_procurement, tab == HomeTab.PROCUREMENT, stops.count { it.stopType == "pickup" && !DayLogic.isDone(it) }) {
                onSelect(HomeTab.PROCUREMENT)
            }
            TabItem(Glyph.Truck, R.string.tab_delivery, tab == HomeTab.DELIVERY, stops.count { it.stopType == "delivery" && !DayLogic.isDone(it) }) {
                onSelect(HomeTab.DELIVERY)
            }
        }
    }
}

@Composable
private fun RowScope.TabItem(glyph: Glyph, label: Int, selected: Boolean, badge: Int?, onClick: () -> Unit) {
    Column(
        Modifier
            .weight(1f)
            .clip(RoundedCornerShape(16.dp))
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box {
            Box(
                Modifier.width(60.dp).height(32.dp).clip(CircleShape).background(if (selected) Fresh.primaryTint else Color.Transparent),
                contentAlignment = Alignment.Center,
            ) {
                GlyphIcon(glyph, if (selected) Fresh.primary else Fresh.inkMuted, size = 22.dp)
            }
            if (badge != null && badge > 0) {
                Box(
                    Modifier.align(Alignment.TopEnd).size(18.dp).clip(CircleShape).background(Fresh.warning),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("$badge", style = MaterialTheme.typography.labelSmall, color = Color.White)
                }
            }
        }
        Text(
            stringResource(label),
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) Fresh.primary else Fresh.inkMuted,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}
