package com.morbeez.driver.ui.screens.startday

import android.Manifest
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.HoldToConfirm
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.KmProblem
import com.morbeez.driver.ui.theme.Fresh
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.delay

/**
 * Start Day (design sheet screen 1): the planned vehicle and driver, the
 * opening KM off the odometer, the date and time, where the phone is, then
 * hold to start. The owner plans first (client's answer 2): with no trip
 * for today there's nothing to start.
 */
@Composable
fun StartDayScreen(onBack: () -> Unit, onStarted: () -> Unit, viewModel: StartDayViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val trip = state.trip
    var km by rememberSaveable { mutableStateOf("") }
    var touched by rememberSaveable { mutableStateOf(false) }

    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { viewModel.locate() }
    val permissions = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    LaunchedEffect(Unit) {
        if (viewModel.hasLocationPermission()) viewModel.locate() else askLocation.launch(permissions)
    }
    // Back from the phone's settings (location switched on, permission given): look again.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) viewModel.locate() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(state.started, trip?.status) {
        if (state.started && trip?.status == "in_progress") onStarted()
    }

    var now by remember { mutableStateOf(LocalDateTime.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(20_000)
            now = LocalDateTime.now()
        }
    }

    StartDayContent(
        state = state,
        km = km,
        onKm = { typed ->
            km = typed.filter { it.isDigit() || it == '.' }.take(10)
            touched = true
        },
        touched = touched,
        now = now,
        onBack = onBack,
        onStart = { km.trim().toDoubleOrNull()?.let(viewModel::start) },
        onAllowLocation = { askLocation.launch(permissions) },
        onTurnOnLocation = { runCatching { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) } },
    )
}

/** Start Day from state alone (the screenshot tests draw it with a sample day). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun StartDayContent(
    state: StartDayUiState,
    km: String,
    onKm: (String) -> Unit,
    touched: Boolean,
    now: LocalDateTime,
    onBack: () -> Unit,
    onStart: () -> Unit,
    onAllowLocation: () -> Unit,
    onTurnOnLocation: () -> Unit,
) {
    val trip = state.trip
    val lastReading = state.day?.lastOdometerKm
    val lastKm = lastReading?.toDoubleOrNull()
    val problem = DayLogic.openingKmProblem(km, lastKm)
    val canStart = trip?.status == "planned" && problem == null && !state.started
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()

    FieldScreen(
        title = stringResource(R.string.start_day),
        eyebrow = DateTimeFormatter.ofPattern("EEEE, d MMMM", locale).format(now),
        onBack = onBack,
        headerExtra = {
            Text(
                stringResource(R.string.start_day_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = Fresh.onCarbonMuted,
                modifier = Modifier.padding(top = 6.dp),
            )
        },
        bottomBar = {
            HoldToConfirm(text = stringResource(R.string.hold_to_start), onConfirm = onStart, enabled = canStart)
        },
    ) {
        when {
            trip == null -> Callout(stringResource(R.string.no_trip_to_start), Tone.Attention)
            trip.status != "planned" && !state.started -> Callout(stringResource(R.string.already_started), Tone.Good, Glyph.Check)
        }

        FieldCard {
            Eyebrow(stringResource(R.string.vehicle))
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
                GlyphIcon(Glyph.Truck, Fresh.primary, size = 22.dp)
                Spacer(Modifier.width(10.dp))
                Text(
                    state.day?.vehicleRegistration ?: trip?.vehicleRegistrationNumber ?: "—",
                    style = MaterialTheme.typography.titleLarge,
                    color = Fresh.ink,
                    modifier = Modifier.weight(1f),
                )
                GlyphIcon(Glyph.Lock, Fresh.inkFaint, size = 18.dp)
            }
            Text(stringResource(R.string.planned_by_owner), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 2.dp))
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 14.dp))
            Eyebrow(stringResource(R.string.driver))
            Text(state.day?.driverName ?: "—", style = MaterialTheme.typography.titleMedium, color = Fresh.ink, modifier = Modifier.padding(top = 4.dp))
            if (trip != null) {
                HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 14.dp))
                Eyebrow(stringResource(R.string.trip))
                Text(
                    listOfNotNull(trip.number, state.day?.routeName, pluralStringResource(R.plurals.n_stops, state.stopCount, state.stopCount)).joinToString(" · "),
                    style = MaterialTheme.typography.titleMedium,
                    color = Fresh.ink,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }

        FieldCard {
            Eyebrow(stringResource(R.string.opening_km))
            Spacer(Modifier.padding(top = 8.dp))
            FreshTextField(
                value = km,
                onValueChange = onKm,
                label = stringResource(R.string.odometer_reading),
                keyboardType = KeyboardType.Decimal,
                leading = Glyph.Gauge,
            )
            val shownProblem = problem?.takeIf { touched || it != KmProblem.REQUIRED }
            Text(
                when (shownProblem) {
                    KmProblem.REQUIRED -> stringResource(R.string.km_required)
                    KmProblem.NOT_A_NUMBER -> stringResource(R.string.km_not_number)
                    KmProblem.ONE_DECIMAL -> stringResource(R.string.km_one_decimal)
                    KmProblem.BELOW_LAST -> stringResource(R.string.km_below_last, DayLogic.quantity(lastReading))
                    null -> if (lastKm != null) stringResource(R.string.last_reading, DayLogic.quantity(lastReading)) else stringResource(R.string.read_odometer)
                },
                style = MaterialTheme.typography.bodySmall,
                color = if (shownProblem != null) Fresh.critical else Fresh.inkMuted,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        FieldCard {
            Row(verticalAlignment = Alignment.Top) {
                GlyphIcon(Glyph.Clock, Fresh.primary, size = 20.dp)
                Spacer(Modifier.width(12.dp))
                Column {
                    Eyebrow(stringResource(R.string.date_time))
                    Text(DateTimeFormatter.ofPattern("d MMM yyyy · HH:mm", locale).format(now), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                }
            }
            Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(top = 14.dp)) {
                GlyphIcon(Glyph.Pin, Fresh.primary, size = 20.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Eyebrow(stringResource(R.string.location))
                    val position = state.position
                    Text(
                        when {
                            position != null -> {
                                val at = String.format(Locale.ROOT, "%.5f, %.5f", position.latitude, position.longitude)
                                position.accuracyMeters?.let { stringResource(R.string.gps_accuracy, at, it.toInt()) } ?: at
                            }
                            state.gps == GpsState.NO_PERMISSION -> stringResource(R.string.gps_no_permission)
                            state.gps == GpsState.OFF -> stringResource(R.string.gps_off)
                            state.gps == GpsState.UNAVAILABLE -> stringResource(R.string.gps_unavailable)
                            else -> stringResource(R.string.gps_finding)
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = Fresh.ink,
                    )
                }
            }
            FlowRow(
                Modifier.padding(top = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (state.gps) {
                    GpsState.LOCKED -> Pill(stringResource(R.string.gps_locked), Tone.Good)
                    GpsState.FINDING -> Pill(stringResource(R.string.gps_searching), Tone.Active)
                    else -> Pill(stringResource(R.string.gps_none), Tone.Attention)
                }
                Pill(stringResource(if (state.online) R.string.online else R.string.offline), if (state.online) Tone.Good else Tone.Attention)
            }
            when (state.gps) {
                GpsState.NO_PERMISSION -> SecondaryAction(stringResource(R.string.allow_location), onAllowLocation, Modifier.padding(top = 14.dp), glyph = Glyph.Pin)
                GpsState.OFF -> SecondaryAction(stringResource(R.string.turn_on_location), onTurnOnLocation, Modifier.padding(top = 14.dp), glyph = Glyph.Pin)
                else -> Unit
            }
        }

        Text(
            stringResource(R.string.start_offline_note),
            style = MaterialTheme.typography.bodySmall,
            color = Fresh.inkFaint,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
    }
}
