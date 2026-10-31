package com.morbeez.driver.data.repository

import android.content.Context
import com.morbeez.driver.R
import com.morbeez.driver.data.i18n.AppLanguage
import com.morbeez.driver.data.local.BackhaulDao
import com.morbeez.driver.data.local.ChatDao
import com.morbeez.driver.data.local.ExpenseDao
import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.local.TripDao
import com.morbeez.driver.data.local.TripStopDao
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.data.sync.QueueLogic
import com.morbeez.driver.data.sync.ReturnTripPayload
import com.morbeez.driver.ui.screens.home.DayLogic
import com.squareup.moshi.Moshi
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * What the office refused, and what the driver does about it (D8, field
 * hardening; Driver App Architecture DRV.8): never retried with a "corrected"
 * payload behind the driver's back. The driver corrects a reading or an
 * amount — sent again in its place, with its own idempotency key (a refusal
 * stores nothing under it) — or removes it from the phone, and the office is
 * told in the chat what was removed and why, so nothing with money in it
 * disappears unseen.
 */
@Singleton
class QueueRepository @Inject constructor(
    private val pendingOperationDao: PendingOperationDao,
    private val pendingPhotoDao: PendingPhotoDao,
    private val tripDao: TripDao,
    private val stopDao: TripStopDao,
    private val expenseDao: ExpenseDao,
    private val backhaulDao: BackhaulDao,
    private val chatDao: ChatDao,
    private val chat: ChatRepository,
    private val moshi: Moshi,
    @ApplicationContext private val appContext: Context,
) {
    private val res get() = AppLanguage.wrap(appContext).resources

    fun observeFailedPhotos(): Flow<List<PendingPhotoEntity>> = pendingPhotoDao.observeFailed()

    /** Each stop with an action the office refused, and its words (the banner on the stop, DRV.8). */
    fun observeRefusedStops(): Flow<Map<String, String>> = pendingOperationDao.observeFailed().map { QueueLogic.refusedStops(it, moshi) }

    /** Return's closing KM, read again: sent in its place in the queue, under its own key (a refusal stores nothing under it). */
    suspend fun fixReturn(op: PendingOperationEntity, closingKm: Double) {
        val adapter = moshi.adapter(ReturnTripPayload::class.java)
        val payload = adapter.fromJson(op.payloadJson) ?: return
        pendingOperationDao.retryWith(op.idempotencyKey, adapter.toJson(payload.copy(closingKm = closingKm)))
        tripDao.findById(op.tripId)?.let { tripDao.markReturned(op.tripId, String.format(Locale.ROOT, "%.1f", closingKm), it.returnedAt ?: java.time.Instant.now().toString()) }
    }

    /**
     * Off the phone, never sent: the queue goes on behind it, and what this
     * phone showed for it goes with it. Anything but a chat message, the
     * office is told — [note] is the driver's own account (required, for
     * money, by the screen).
     */
    suspend fun remove(op: PendingOperationEntity, note: String?) {
        pendingOperationDao.delete(op.idempotencyKey)
        val fields = QueueLogic.fields(op.payloadJson, moshi)
        when (op.operationType) {
            PendingOperationType.RECORD_EXPENSE.name -> (fields["expenseId"] as? String)?.let { id ->
                expenseDao.delete(id)
                dropPhotos(id)
            }
            PendingOperationType.CREATE_BACKHAUL.name -> (fields["backhaulId"] as? String)?.let { id ->
                backhaulDao.deleteUnsent(id)
                dropPhotos(id)
            }
            PendingOperationType.SEND_MESSAGE.name -> (fields["messageId"] as? String)?.let { id ->
                chatDao.find(id)?.localPhotoPath?.let { File(it).delete() }
                chatDao.delete(id)
                dropPhotos(id)
                return // a message to the office: nothing to tell it
            }
            PendingOperationType.READ_CHAT.name -> return
        }
        tellOffice(op.tripId, describe(op), op.lastError, note)
    }

    /** A photo the office refused (or lost from the phone): off the queue, the office told. */
    suspend fun removePhoto(photo: PendingPhotoEntity, note: String?) {
        pendingPhotoDao.delete(photo.id)
        File(photo.localPath).delete()
        if (photo.target == "chat") return
        tellOffice(photo.tripId, res.getString(R.string.removed_photo_what, photo.photoType), photo.lastError, note)
    }

    private suspend fun dropPhotos(ownerId: String) {
        for (p in pendingPhotoDao.forOwner(ownerId)) {
            pendingPhotoDao.delete(p.id)
            File(p.localPath).delete()
        }
    }

    /** "Collection — ₹600 cash, Hotel Sagar": what it was, in the driver's language. */
    suspend fun describe(op: PendingOperationEntity): String {
        val parts = mutableListOf<String>()
        QueueLogic.amountOf(op, moshi)?.let { parts += res.getString(R.string.rupees, DayLogic.rupees(String.format(Locale.ROOT, "%.2f", it))) }
        QueueLogic.kmOf(op, moshi)?.let { parts += res.getString(R.string.km_value, DayLogic.quantity(it.toString())) }
        QueueLogic.detailOf(op, moshi)?.let { parts += it.replace('_', ' ') }
        QueueLogic.stopIdOf(op, moshi)?.let { id -> stopDao.findById(id)?.counterpartyName?.let { parts += it } }
        val label = res.getString(labelOf(op.operationType))
        return if (parts.isEmpty()) label else "$label — ${parts.joinToString(", ")}"
    }

    private suspend fun tellOffice(tripId: String, what: String, reason: String?, note: String?) {
        val text = buildString {
            append(res.getString(R.string.removed_note, what, reason?.ifBlank { null } ?: res.getString(R.string.removed_no_reason)))
            note?.trim()?.ifBlank { null }?.let { append("\n").append(it) }
        }
        val trip = tripId.ifBlank { null }?.let { id -> tripDao.findById(id)?.let { it.id to it.number } }
        chat.send(text, trip, null)
    }

    companion object {
        /** Each queued action's name, as the Sync screen and the office read it. */
        fun labelOf(type: String): Int = when (runCatching { PendingOperationType.valueOf(type) }.getOrNull()) {
            PendingOperationType.START_TRIP -> R.string.op_start_trip
            PendingOperationType.ARRIVE_STOP -> R.string.op_arrive
            PendingOperationType.START_DELIVERIES -> R.string.op_start_deliveries
            PendingOperationType.RETURN_TRIP -> R.string.op_return_trip
            PendingOperationType.RAISE_DISPUTE -> R.string.op_raise_dispute
            PendingOperationType.COMPLETE_PICKUP_STOP -> R.string.op_complete_pickup
            PendingOperationType.COMPLETE_DELIVERY_STOP -> R.string.op_complete_delivery
            PendingOperationType.SKIP_STOP -> R.string.op_skip_stop
            PendingOperationType.RECORD_EXPENSE -> R.string.op_expense
            PendingOperationType.RECORD_COLLECTION -> R.string.op_collection
            PendingOperationType.RECORD_DEPOSIT -> R.string.op_deposit
            PendingOperationType.SUBMIT_TRIP -> R.string.op_submit_trip
            PendingOperationType.REPORT_PROBLEM -> R.string.op_problem
            PendingOperationType.CREATE_BACKHAUL -> R.string.op_add_backhaul
            PendingOperationType.ACCEPT_BACKHAUL -> R.string.op_accept_backhaul
            PendingOperationType.SKIP_BACKHAUL -> R.string.op_skip_backhaul
            PendingOperationType.BACKHAUL_STEP -> R.string.op_backhaul_step
            PendingOperationType.PAY_BACKHAUL -> R.string.op_pay_backhaul
            PendingOperationType.ACKNOWLEDGE_PAY -> R.string.op_ack_pay
            PendingOperationType.SEND_MESSAGE -> R.string.op_send_message
            PendingOperationType.READ_CHAT -> R.string.op_read_chat
            PendingOperationType.CREATE_REQUEST -> R.string.op_request
            null -> R.string.op_other
        }
    }
}
