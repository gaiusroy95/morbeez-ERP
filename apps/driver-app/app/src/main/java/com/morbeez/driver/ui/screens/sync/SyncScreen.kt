package com.morbeez.driver.ui.screens.sync

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.morbeez.driver.R
import com.morbeez.driver.data.device.NetworkMonitor
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.data.sync.SyncWorker
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.Stat
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.KmProblem
import com.morbeez.driver.ui.screens.home.LinkLine
import com.morbeez.driver.ui.screens.home.LinkState
import com.morbeez.driver.ui.screens.home.clockOf
import com.morbeez.driver.ui.theme.Fresh
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SyncUiState(
    val link: LinkState = LinkState(),
    val failed: List<PendingOperationEntity> = emptyList(),
    val refreshedAt: Long? = null,
    val lastOdometerKm: String? = null,
)

@HiltViewModel
class SyncViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
    network: NetworkMonitor,
) : ViewModel() {
    private val isSyncing = WorkManager.getInstance(appContext)
        .getWorkInfosForUniqueWorkFlow(SyncWorker.NOW_WORK_NAME)
        .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }

    val state: StateFlow<SyncUiState> = combine(
        network.online,
        isSyncing,
        trips.observePendingCount(),
        trips.observeFailedOperations(),
        trips.observeDay(),
    ) { online, syncing, waiting, failed, day ->
        SyncUiState(LinkState(online, syncing, waiting + failed.size, failed.size), failed, day?.refreshedAt, day?.lastOdometerKm)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SyncUiState())

    fun syncNow() = SyncWorker.requestNow(appContext)

    fun correctStartDay(operation: PendingOperationEntity, openingKm: Double) {
        viewModelScope.launch {
            trips.correctStartDay(operation, openingKm)
            SyncWorker.requestNow(appContext)
        }
    }
}

/**
 * Sync (side drawer → Other): what's on this phone waiting for the office,
 * when the office last answered, and anything the office refused — with
 * its reason, tried again on Sync now.
 */
@Composable
fun SyncScreen(onBack: () -> Unit, viewModel: SyncViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SyncContent(state, onBack, onSync = viewModel::syncNow, onCorrect = viewModel::correctStartDay)
}

/** Sync from state alone (the screenshot tests draw it with a sample queue). */
@Composable
internal fun SyncContent(
    state: SyncUiState,
    onBack: () -> Unit,
    onSync: () -> Unit,
    onCorrect: (PendingOperationEntity, Double) -> Unit,
) {
    var correcting by remember { mutableStateOf<PendingOperationEntity?>(null) }

    FieldScreen(
        title = stringResource(R.string.drawer_sync),
        eyebrow = stringResource(R.string.sync_eyebrow),
        onBack = onBack,
        bottomBar = {
            PrimaryAction(
                text = stringResource(if (state.link.syncing) R.string.syncing else R.string.sync_now),
                onClick = onSync,
                loading = state.link.syncing,
                glyph = Glyph.Sync,
            )
        },
    ) {
        FieldCard {
            LinkLine(state.link, onDark = false)
            Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.Bottom) {
                Stat(stringResource(R.string.waiting_to_send), "${state.link.waiting}", modifier = Modifier.weight(1f))
                Stat(stringResource(R.string.needs_attention), "${state.link.failed}", modifier = Modifier.weight(1f))
            }
            Text(
                state.refreshedAt?.let { stringResource(R.string.last_update, clockOf(it)) } ?: stringResource(R.string.never_updated),
                style = MaterialTheme.typography.bodySmall,
                color = Fresh.inkMuted,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
        Callout(stringResource(R.string.sync_explainer), Tone.Active, Glyph.Sync)

        if (state.failed.isEmpty()) {
            Callout(stringResource(R.string.nothing_stuck), Tone.Good, Glyph.Check)
        } else {
            Eyebrow(stringResource(R.string.needs_attention), modifier = Modifier.padding(start = 4.dp, top = 4.dp))
            state.failed.forEach { operation ->
                FieldCard {
                    Text(stringResource(labelOf(operation.operationType)), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                    Text(clockOf(operation.createdAt), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint)
                    operation.lastError?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = Fresh.critical, modifier = Modifier.padding(top = 8.dp))
                    }
                    Text(stringResource(R.string.failed_retry_note), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 8.dp))
                    if (operation.operationType == PendingOperationType.START_TRIP.name) {
                        Spacer(Modifier.height(12.dp))
                        SecondaryAction(stringResource(R.string.correct_opening_km), { correcting = operation }, glyph = Glyph.Gauge)
                    }
                }
            }
        }
    }

    correcting?.let { operation ->
        CorrectKmDialog(
            lastKm = state.lastOdometerKm,
            onSave = { km ->
                onCorrect(operation, km)
                correcting = null
            },
            onDismiss = { correcting = null },
        )
    }
}

@Composable
private fun CorrectKmDialog(lastKm: String?, onSave: (Double) -> Unit, onDismiss: () -> Unit) {
    var km by remember { mutableStateOf("") }
    // The phone's last reading may be the very one the server says is stale: only the format is checked here.
    val problem = DayLogic.openingKmProblem(km, null)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fresh.surface,
        title = { Text(stringResource(R.string.correct_km_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
        text = {
            Column {
                FreshTextField(
                    value = km,
                    onValueChange = { typed -> km = typed.filter { it.isDigit() || it == '.' }.take(10) },
                    label = stringResource(R.string.odometer_reading),
                    keyboardType = KeyboardType.Decimal,
                    leading = Glyph.Gauge,
                )
                Text(
                    when {
                        problem == KmProblem.NOT_A_NUMBER -> stringResource(R.string.km_not_number)
                        problem == KmProblem.ONE_DECIMAL -> stringResource(R.string.km_one_decimal)
                        lastKm != null -> stringResource(R.string.last_reading, DayLogic.quantity(lastKm))
                        else -> stringResource(R.string.read_odometer)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (problem != null && problem != KmProblem.REQUIRED) Fresh.critical else Fresh.inkMuted,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { km.trim().toDoubleOrNull()?.let(onSave) }, enabled = problem == null) {
                Text(stringResource(R.string.save_and_send), color = if (problem == null) Fresh.primary else Fresh.inkFaint)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
    )
}

private fun labelOf(type: String): Int = when (runCatching { PendingOperationType.valueOf(type) }.getOrNull()) {
    PendingOperationType.START_TRIP -> R.string.op_start_trip
    PendingOperationType.ARRIVE_STOP -> R.string.op_arrive
    PendingOperationType.START_DELIVERIES -> R.string.op_start_deliveries
    PendingOperationType.COMPLETE_PICKUP_STOP -> R.string.op_complete_pickup
    PendingOperationType.COMPLETE_DELIVERY_STOP -> R.string.op_complete_delivery
    PendingOperationType.SKIP_STOP -> R.string.op_skip_stop
    PendingOperationType.RECORD_EXPENSE -> R.string.op_expense
    PendingOperationType.RECORD_COLLECTION -> R.string.op_collection
    PendingOperationType.RECORD_DEPOSIT -> R.string.op_deposit
    PendingOperationType.SUBMIT_TRIP -> R.string.op_submit_trip
    PendingOperationType.REPORT_PROBLEM -> R.string.op_problem
    null -> R.string.op_other
}
