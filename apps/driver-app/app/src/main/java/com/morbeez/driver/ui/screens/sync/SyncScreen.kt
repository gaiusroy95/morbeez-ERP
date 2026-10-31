package com.morbeez.driver.ui.screens.sync

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.repository.QueueRepository
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.data.sync.QueueLogic
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
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SyncUiState(
    val link: LinkState = LinkState(),
    val failed: List<PendingOperationEntity> = emptyList(),
    val refreshedAt: Long? = null,
    val lastOdometerKm: String? = null,
    /** Photos the office refused, or lost from the phone (D8). */
    val failedPhotos: List<PendingPhotoEntity> = emptyList(),
    /** Each refused action as the driver reads it — "Collection — ₹600 cash, Hotel Sagar" — by its key. */
    val described: Map<String, String> = emptyMap(),
)

/** What the driver can do about a refused action (D8). */
data class SyncFixes(
    val correctReturn: (PendingOperationEntity, Double) -> Unit = { _, _ -> },
    val remove: (PendingOperationEntity, String?) -> Unit = { _, _ -> },
    val removePhoto: (PendingPhotoEntity, String?) -> Unit = { _, _ -> },
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class SyncViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val trips: TripRepository,
    private val queue: QueueRepository,
    network: NetworkMonitor,
) : ViewModel() {
    private val isSyncing = WorkManager.getInstance(appContext)
        .getWorkInfosForUniqueWorkFlow(SyncWorker.NOW_WORK_NAME)
        .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }

    private val described = trips.observeFailedOperations().mapLatest { ops -> ops.associate { it.idempotencyKey to queue.describe(it) } }

    private val refused = combine(trips.observeFailedOperations(), queue.observeFailedPhotos(), described) { ops, photos, words -> Triple(ops, photos, words) }

    val state: StateFlow<SyncUiState> = combine(
        network.online,
        isSyncing,
        trips.observePendingCount(),
        refused,
        trips.observeDay(),
    ) { online, syncing, waiting, (failed, photos, words), day ->
        SyncUiState(LinkState(online, syncing, waiting + failed.size, failed.size + photos.size), failed, day?.refreshedAt, day?.lastOdometerKm, photos, words)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SyncUiState())

    fun syncNow() = SyncWorker.requestNow(appContext)

    private fun then(work: suspend () -> Unit) {
        viewModelScope.launch {
            work()
            SyncWorker.requestNow(appContext)
        }
    }

    fun correctStartDay(operation: PendingOperationEntity, openingKm: Double) = then { trips.correctStartDay(operation, openingKm) }

    val fixes = SyncFixes(
        correctReturn = { op, km -> then { queue.fixReturn(op, km) } },
        remove = { op, note -> then { queue.remove(op, note) } },
        removePhoto = { photo, note -> then { queue.removePhoto(photo, note) } },
    )
}

/**
 * Sync (side drawer → Other): what's on this phone waiting for the office,
 * when the office last answered, and anything the office refused — with its
 * reason (DRV.8). A refused action holds back what came after it (DRV.7):
 * correct it and send it again, or remove it from the phone — the office is
 * told in the chat. Losing signal never lands here: it just waits (D8).
 */
@Composable
fun SyncScreen(onBack: () -> Unit, viewModel: SyncViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SyncContent(state, onBack, onSync = viewModel::syncNow, onCorrect = viewModel::correctStartDay, fixes = viewModel.fixes)
}

private sealed interface Dialog {
    data class StartKm(val op: PendingOperationEntity) : Dialog
    data class ReturnKm(val op: PendingOperationEntity) : Dialog
    data class Remove(val op: PendingOperationEntity) : Dialog
    data class RemovePhoto(val photo: PendingPhotoEntity) : Dialog
}

/** Sync from state alone (the screenshot tests draw it with a sample queue). */
@Composable
internal fun SyncContent(
    state: SyncUiState,
    onBack: () -> Unit,
    onSync: () -> Unit,
    onCorrect: (PendingOperationEntity, Double) -> Unit,
    fixes: SyncFixes = SyncFixes(),
    initialDialog: Int? = null,
) {
    var dialog by remember {
        mutableStateOf<Dialog?>(
            // The screenshot tests open the first refused action's removal (0) or fix (1).
            state.failed.firstOrNull()?.let { op -> if (initialDialog == 0) Dialog.Remove(op) else if (initialDialog == 1) fixDialogOf(op) else null },
        )
    }

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

        if (state.failed.isEmpty() && state.failedPhotos.isEmpty()) {
            Callout(stringResource(R.string.nothing_stuck), Tone.Good, Glyph.Check)
        } else {
            Eyebrow(stringResource(R.string.needs_attention), modifier = Modifier.padding(start = 4.dp, top = 4.dp))
            Callout(stringResource(R.string.refused_explainer), Tone.Attention, Glyph.Warning)
            state.failed.forEach { operation ->
                FieldCard {
                    Text(
                        state.described[operation.idempotencyKey] ?: stringResource(QueueRepository.labelOf(operation.operationType)),
                        style = MaterialTheme.typography.titleMedium,
                        color = Fresh.ink,
                    )
                    Text(clockOf(operation.createdAt), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint)
                    operation.lastError?.let {
                        Text(stringResource(R.string.office_said, it), style = MaterialTheme.typography.bodyMedium, color = Fresh.critical, modifier = Modifier.padding(top = 8.dp))
                    }
                    Text(stringResource(R.string.failed_retry_note), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 8.dp))
                    Spacer(Modifier.height(12.dp))
                    Row {
                        fixDialogOf(operation)?.let { fix ->
                            SecondaryAction(stringResource(fixLabelOf(operation)), { dialog = fix }, Modifier.weight(1f), glyph = Glyph.Pen)
                            Spacer(Modifier.width(8.dp))
                        }
                        SecondaryAction(stringResource(R.string.remove_from_phone), { dialog = Dialog.Remove(operation) }, Modifier.weight(1f))
                    }
                }
            }
            state.failedPhotos.forEach { photo ->
                FieldCard {
                    Text(stringResource(R.string.removed_photo_what, photo.photoType), style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                    Text(clockOf(photo.createdAt), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint)
                    photo.lastError?.let {
                        Text(stringResource(R.string.office_said, it), style = MaterialTheme.typography.bodyMedium, color = Fresh.critical, modifier = Modifier.padding(top = 8.dp))
                    }
                    Spacer(Modifier.height(12.dp))
                    SecondaryAction(stringResource(R.string.remove_photo_from_phone), { dialog = Dialog.RemovePhoto(photo) })
                }
            }
        }
    }

    when (val d = dialog) {
        is Dialog.StartKm -> NumberDialog(
            title = stringResource(R.string.correct_km_title),
            label = stringResource(R.string.odometer_reading),
            hint = state.lastOdometerKm?.let { stringResource(R.string.last_reading, DayLogic.quantity(it)) } ?: stringResource(R.string.read_odometer),
            onSave = { onCorrect(d.op, it); dialog = null },
            onDismiss = { dialog = null },
        )
        is Dialog.ReturnKm -> NumberDialog(
            title = stringResource(R.string.correct_closing_km_title),
            label = stringResource(R.string.odometer_reading),
            hint = stringResource(R.string.read_odometer),
            onSave = { fixes.correctReturn(d.op, it); dialog = null },
            onDismiss = { dialog = null },
        )
        is Dialog.Remove -> RemoveDialog(
            what = state.described[d.op.idempotencyKey] ?: stringResource(QueueRepository.labelOf(d.op.operationType)),
            money = d.op.operationType in QueueLogic.MONEY,
            tellsOffice = d.op.operationType != PendingOperationType.SEND_MESSAGE.name && d.op.operationType != PendingOperationType.READ_CHAT.name,
            onRemove = { note -> fixes.remove(d.op, note); dialog = null },
            onDismiss = { dialog = null },
        )
        is Dialog.RemovePhoto -> RemoveDialog(
            what = stringResource(R.string.removed_photo_what, d.photo.photoType),
            money = false,
            tellsOffice = d.photo.target != "chat",
            onRemove = { note -> fixes.removePhoto(d.photo, note); dialog = null },
            onDismiss = { dialog = null },
        )
        null -> Unit
    }
}

private fun fixDialogOf(op: PendingOperationEntity): Dialog? = when (op.operationType) {
    PendingOperationType.START_TRIP.name -> Dialog.StartKm(op)
    PendingOperationType.RETURN_TRIP.name -> Dialog.ReturnKm(op)
    else -> null
}

private fun fixLabelOf(op: PendingOperationEntity): Int =
    if (op.operationType == PendingOperationType.START_TRIP.name) R.string.correct_opening_km else R.string.correct_closing_km

/** An odometer reading, read again: only its form is checked here — the office checks the rest. */
@Composable
private fun NumberDialog(title: String, label: String, hint: String, onSave: (Double) -> Unit, onDismiss: () -> Unit) {
    var value by remember { mutableStateOf("") }
    val problem = DayLogic.openingKmProblem(value, null)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fresh.surface,
        title = { Text(title, style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
        text = {
            Column {
                FreshTextField(
                    value = value,
                    onValueChange = { typed -> value = typed.filter { it.isDigit() || it == '.' }.take(10) },
                    label = label,
                    keyboardType = KeyboardType.Decimal,
                    leading = Glyph.Gauge,
                )
                Text(
                    when {
                        value.isEmpty() -> hint
                        problem == KmProblem.NOT_A_NUMBER -> stringResource(R.string.km_not_number)
                        problem == KmProblem.ONE_DECIMAL -> stringResource(R.string.km_one_decimal)
                        else -> hint
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (value.isNotEmpty() && problem != null) Fresh.critical else Fresh.inkMuted,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { value.trim().toDoubleOrNull()?.let(onSave) }, enabled = problem == null) {
                Text(stringResource(R.string.save_and_send), color = if (problem == null) Fresh.primary else Fresh.inkFaint)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
    )
}

/**
 * Removing is the driver's decision, made knowingly: what won't reach the
 * office, that the office is told, and — when there's money in it — what
 * happened, in the driver's words.
 */
@Composable
private fun RemoveDialog(what: String, money: Boolean, tellsOffice: Boolean, onRemove: (String?) -> Unit, onDismiss: () -> Unit) {
    var note by remember { mutableStateOf("") }
    val ready = !money || note.isNotBlank()
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Fresh.surface,
        title = { Text(stringResource(R.string.remove_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
        text = {
            Column {
                Text(stringResource(R.string.remove_text, what), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink)
                if (tellsOffice) {
                    Text(stringResource(R.string.remove_tells_office), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(top = 8.dp))
                    Spacer(Modifier.height(10.dp))
                    FreshTextField(
                        value = note,
                        onValueChange = { note = it.take(300) },
                        label = stringResource(if (money) R.string.remove_note_required else R.string.remove_note_optional),
                        singleLine = false,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onRemove(note.trim().ifBlank { null }) }, enabled = ready) {
                Text(stringResource(R.string.remove), color = if (ready) Fresh.critical else Fresh.inkFaint)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
    )
}
