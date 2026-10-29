package com.morbeez.driver.ui.screens.deliver

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.R
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.clockOf
import com.morbeez.driver.ui.theme.Fresh
import dagger.hilt.android.lifecycle.HiltViewModel
import java.math.BigDecimal
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

data class VehicleStockUiState(
    val registration: String? = null,
    val lines: List<StockLine> = emptyList(),
    /** Every delivery on the trip done (or skipped): the vehicle should now be empty (client spec §15). */
    val deliveriesDone: Boolean = false,
    /** Done on this phone, not counted by the server yet. */
    val unsent: Int = 0,
    val refreshedAt: Long? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class VehicleStockViewModel @Inject constructor(trips: TripRepository) : ViewModel() {
    private val tripWithStops = trips.observeActiveTrip().flatMapLatest { trip ->
        if (trip == null) {
            flowOf<Pair<TripEntity?, List<TripStopEntity>>>(null to emptyList())
        } else {
            trips.observeStops(trip.id).map<List<TripStopEntity>, Pair<TripEntity?, List<TripStopEntity>>> { trip to it }
        }
    }

    val state: StateFlow<VehicleStockUiState> = combine(trips.observeDay(), tripWithStops) { day, (trip, stops) ->
        val lines = DeliveryLogic.stockOf(
            trips.stockOf(day),
            stops,
            stops.mapNotNull { s -> trips.farmOf(s)?.let { s.id to it } }.toMap(),
            stops.mapNotNull { s -> trips.deliveryOf(s)?.let { s.id to it } }.toMap(),
        ) { trips.itemsOf(it) }
        val deliveries = stops.filter { it.stopType == "delivery" }
        VehicleStockUiState(
            registration = day?.vehicleRegistration ?: trip?.vehicleRegistrationNumber,
            lines = lines,
            deliveriesDone = deliveries.isNotEmpty() && deliveries.none { it.status == "pending" },
            unsent = stops.count { it.pendingSync },
            refreshedAt = day?.refreshedAt,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), VehicleStockUiState())
}

@Composable
fun VehicleStockScreen(onBack: () -> Unit, viewModel: VehicleStockViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    VehicleStockContent(state, onBack)
}

/**
 * Vehicle stock (design sheet screen 12): what's on the vehicle, product by
 * product, and the total — which must be 0 kg after the last delivery
 * (client spec §15). What's left goes back to the owner when the trip is
 * closed (the client's answer 3).
 */
@Composable
internal fun VehicleStockContent(state: VehicleStockUiState, onBack: () -> Unit) {
    val total = DeliveryLogic.kgOf(state.lines) { it.onVehicle }
    FieldScreen(title = stringResource(R.string.tile_stock), eyebrow = state.registration, onBack = onBack) {
        FieldCard {
            if (state.lines.isEmpty()) {
                Text(stringResource(R.string.nothing_on_vehicle), style = MaterialTheme.typography.bodyLarge, color = Fresh.inkMuted)
            }
            state.lines.forEachIndexed { i, line ->
                if (i > 0) HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(line.product, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                        if (line.toDeliver.signum() > 0) {
                            Text(
                                stringResource(R.string.stock_to_deliver, "${DayLogic.quantity(line.toDeliver.toPlainString())} ${line.uom}"),
                                style = MaterialTheme.typography.bodySmall,
                                color = Fresh.inkMuted,
                            )
                        }
                    }
                    Text("${DayLogic.quantity(line.onVehicle.toPlainString())} ${line.uom}", style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Fresh.primaryTint).padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.total), style = MaterialTheme.typography.titleLarge, color = Fresh.primaryStrong, modifier = Modifier.weight(1f))
            Text(
                stringResource(R.string.kg_value, DayLogic.quantity(total.toPlainString())),
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                color = Fresh.primaryStrong,
            )
        }
        when {
            state.deliveriesDone && total.signum() > 0 -> Callout(stringResource(R.string.stock_left_over, DayLogic.quantity(total.toPlainString())), Tone.Attention)
            state.deliveriesDone -> Callout(stringResource(R.string.vehicle_empty), Tone.Good, Glyph.Check)
            else -> Callout(stringResource(R.string.must_be_zero), Tone.Active, Glyph.Box)
        }
        Text(
            listOfNotNull(
                state.refreshedAt?.let { stringResource(R.string.stock_counted_at, clockOf(it)) },
                state.unsent.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.stock_unsent, it, it) },
            ).joinToString(" "),
            style = MaterialTheme.typography.bodySmall,
            color = Fresh.inkFaint,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
    }
}

/** The kilos still aboard, by the phone's reckoning: zero is the goal after the last delivery. */
fun leftOnVehicle(lines: List<StockLine>): BigDecimal = DeliveryLogic.kgOf(lines) { it.onVehicle }
