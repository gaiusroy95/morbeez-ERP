package com.morbeez.driver.data.sync

import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.BackhaulPaymentRequest
import com.morbeez.driver.data.remote.dto.BackhaulStepRequest
import com.morbeez.driver.data.remote.dto.CompleteDeliveryRequest
import com.morbeez.driver.data.remote.dto.CreateBackhaulRequest
import com.morbeez.driver.data.remote.dto.SkipBackhaulRequest
import com.morbeez.driver.data.remote.dto.CompletePickupRequest
import com.morbeez.driver.data.remote.dto.RecordCollectionRequest
import com.morbeez.driver.data.remote.dto.RecordDepositRequest
import com.morbeez.driver.data.remote.dto.CreateDriverRequest
import com.morbeez.driver.data.remote.dto.RecordExpenseRequest
import com.morbeez.driver.data.remote.dto.ReportProblemRequest
import com.morbeez.driver.data.remote.dto.SkipStopRequest
import com.morbeez.driver.data.remote.dto.RaiseDisputeRequest
import com.morbeez.driver.data.remote.dto.ReturnTripRequest
import com.morbeez.driver.data.remote.dto.StartTripRequest
import com.morbeez.driver.data.remote.dto.SubmitTripRequest
import com.morbeez.driver.data.remote.dto.ChatReadRequest
import com.morbeez.driver.data.remote.dto.SendChatMessageRequest
import com.morbeez.driver.data.repository.ChatRepository
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.security.TokenStore
import com.morbeez.driver.BuildConfig
import com.squareup.moshi.Moshi
import java.io.File
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody

enum class SyncResult { SUCCESS, PARTIAL }

/**
 * Operation-log sync: each offline action is a timestamped,
 * idempotency-keyed command replayed against the same handlers the web
 * app uses (System Architecture, MOB.3; Driver App Architecture, DRV.6).
 * Runs via WorkManager for guaranteed background execution (DRV.5).
 *
 * Push always runs before pull (DRV.9), and a queue is drained in strict
 * creation order (DRV.7): the first operation that fails stops the whole
 * push for this pass rather than letting a later, possibly-dependent
 * operation apply out of order. A rejected operation is left as
 * failed_needs_review, never silently retried with a "corrected" payload
 * (DRV.8) — the next sync pass tries it again unchanged; a human decides
 * anything that keeps failing.
 */
class SyncEngine @Inject constructor(
    private val api: ApiService,
    private val pendingOperationDao: PendingOperationDao,
    private val pendingPhotoDao: PendingPhotoDao,
    private val tripRepository: TripRepository,
    private val chatRepository: ChatRepository,
    private val tokenStore: TokenStore,
    private val moshi: Moshi,
) {
    suspend fun sync(): SyncResult = passes.withLock {
        // One pass at a time across every trigger — periodic, app opened,
        // Refresh — so two never race to send the same queued action
        // (Performance Audit PA-11).
        // The chat first and on its own (D9): a message to the office never
        // waits behind a trip action the server refused — it's how the driver
        // asks for help with one.
        val chatDrained = pushOperations(chat = true)
        val operationsDrained = pushOperations(chat = false)

        // Push before pull (DRV.9) is about actions: a pull must never land
        // on top of one the server hasn't seen — so it waits until the queue
        // is empty or all that's left was refused (D8: the driver then sees
        // the office's state, the refused action still on the phone to fix
        // or remove). Photos change no state a pull could overwrite, so the
        // route comes down first and the (slow) photo uploads follow (PA-12).
        if (operationsDrained || onlyRefusedLeft()) {
            runCatching { tripRepository.refreshMyTrips() }
        }
        if (chatDrained) {
            runCatching { chatRepository.refresh() }
        }
        val photosDrained = pushPhotos()

        val result = if (chatDrained && operationsDrained && photosDrained) SyncResult.SUCCESS else SyncResult.PARTIAL
        // The office sees what's still on this phone (owner Phase 8); best effort — never fails the pass.
        if (tokenStore.isLoggedIn()) {
            runCatching {
                api.reportSync(
                    SyncReport.of(tokenStore.deviceId, BuildConfig.VERSION_NAME, pendingOperationDao.nextBatch(), pendingPhotoDao.nextBatch(), result, Instant.now()),
                )
            }
        }
        return@withLock result
    }

    /** The office's lane — chat and requests ([chat]) — or the trip's, each in strict order. */
    private suspend fun pushOperations(chat: Boolean): Boolean {
        for (operation in pendingOperationDao.nextBatch().filter { (it.operationType in OFFICE_OPERATIONS) == chat }) {
            val outcome = runCatching { applyOperation(operation) }
            if (outcome.isSuccess) {
                pendingOperationDao.delete(operation.idempotencyKey)
                continue
            }
            when (Refusal.classify(outcome.exceptionOrNull())) {
                // Refused: it waits for the driver to fix or remove it (DRV.8), and the queue behind it waits too (DRV.7).
                SendFailure.REFUSED -> pendingOperationDao.markFailed(operation.idempotencyKey, "failed_needs_review", reasonOf(outcome.exceptionOrNull()))
                // The business's free trial has ended (402): nothing is wrong
                // with this action. Keep it queued, as it is, and send it once
                // the business subscribes.
                SendFailure.READ_ONLY -> Unit
                // No signal, a timeout, the server down: still waiting, as it was — not the driver's to fix.
                SendFailure.TRANSIENT -> Unit
            }
            return false
        }
        return true
    }

    /** Nothing waiting on the trip's queue but what the office refused (DRV.9's "every remaining item has failed"). */
    private suspend fun onlyRefusedLeft(): Boolean =
        pendingOperationDao.nextBatch().filter { it.operationType !in OFFICE_OPERATIONS }.all { it.status == "failed_needs_review" }

    /** A stop's photos first; one the office refused, or lost from the phone, refuses the action too. */
    private suspend fun requirePhotos(ownerId: String, what: String) {
        if (pushPhotos(ownerId)) return
        val refused = pendingPhotoDao.nextBatch().firstOrNull { it.stopId == ownerId && it.status == "failed_needs_review" }
        if (refused != null) error("A photo for it was refused — remove it in Sync, then send again")
        throw WaitingForPhotos("$what photos haven't uploaded yet")
    }

    private suspend fun applyOperation(operation: PendingOperationEntity) {
        when (PendingOperationType.valueOf(operation.operationType)) {
            PendingOperationType.COMPLETE_PICKUP_STOP -> {
                val payload = parse<CompletePickupPayload>(operation.payloadJson)
                // The farm's photos first: the owner sees the load and the rejections with the stop.
                requirePhotos(payload.stopId, "The farm's")
                api.completePickupStop(
                    operation.tripId,
                    payload.stopId,
                    CompletePickupRequest(payload.weights, payload.lines, payload.packerEmployeeId, payload.loaderEmployeeId),
                )
            }
            PendingOperationType.RETURN_TRIP -> {
                val payload = parse<ReturnTripPayload>(operation.payloadJson)
                api.returnTrip(operation.tripId, ReturnTripRequest(payload.closingKm))
            }
            PendingOperationType.RAISE_DISPUTE -> {
                val payload = parse<RaiseDisputePayload>(operation.payloadJson)
                api.raiseStopDispute(operation.tripId, payload.stopId, RaiseDisputeRequest(payload.amount, payload.reason))
            }
            PendingOperationType.START_DELIVERIES -> {
                api.startDeliveries(operation.tripId)
            }
            PendingOperationType.CREATE_BACKHAUL -> {
                val p = parse<CreateBackhaulPayload>(operation.payloadJson)
                api.createBackhaul(operation.tripId, CreateBackhaulRequest(p.backhaulId, p.pickupPlace, p.dropPlace, p.rent, p.hirerName, p.notes))
            }
            PendingOperationType.ACCEPT_BACKHAUL -> {
                api.acceptBackhaul(operation.tripId, parse<BackhaulPayload>(operation.payloadJson).backhaulId)
            }
            PendingOperationType.SKIP_BACKHAUL -> {
                val p = parse<SkipBackhaulPayload>(operation.payloadJson)
                api.skipBackhaul(operation.tripId, p.backhaulId, SkipBackhaulRequest(p.reason))
            }
            PendingOperationType.BACKHAUL_STEP -> {
                val p = parse<BackhaulStepPayload>(operation.payloadJson)
                // The load and the drop are photographed before their step: those photos go first.
                requirePhotos(p.backhaulId, "The backhaul's")
                api.backhaulStep(operation.tripId, p.backhaulId, BackhaulStepRequest(p.step, p.at))
            }
            PendingOperationType.PAY_BACKHAUL -> {
                val p = parse<PayBackhaulPayload>(operation.payloadJson)
                requirePhotos(p.backhaulId, "The payment proof's")
                api.payBackhaul(operation.tripId, p.backhaulId, BackhaulPaymentRequest(p.method, p.amount, p.reference, p.note, p.at))
            }
            PendingOperationType.ACKNOWLEDGE_PAY -> {
                api.acknowledgeSettlement(parse<AcknowledgePayPayload>(operation.payloadJson).settlementId)
            }
            PendingOperationType.SEND_MESSAGE -> {
                val p = parse<SendMessagePayload>(operation.payloadJson)
                chatRepository.markSent(api.sendChatMessage(SendChatMessageRequest(p.messageId, p.body, p.tripId, p.photo, p.writtenAt)))
            }
            PendingOperationType.READ_CHAT -> {
                api.readChat(ChatReadRequest(parse<ReadChatPayload>(operation.payloadJson).upTo))
            }
            PendingOperationType.ARRIVE_STOP -> {
                val payload = parse<ArriveStopPayload>(operation.payloadJson)
                api.arriveAtStop(operation.tripId, payload.stopId)
            }
            PendingOperationType.COMPLETE_DELIVERY_STOP -> {
                val payload = parse<CompleteDeliveryPayload>(operation.payloadJson)
                // The stop's own photos first: the owner may require a photo of
                // the customer's scale before a customer weight is accepted.
                requirePhotos(payload.stopId, "The delivery's")
                api.completeDeliveryStop(
                    operation.tripId,
                    payload.stopId,
                    CompleteDeliveryRequest(
                        payload.recipientName,
                        payload.signatureData,
                        payload.lines,
                        payload.qrToken,
                        payload.qrNote,
                        payload.allUnloaded,
                        payload.crates,
                    ),
                )
            }
            PendingOperationType.SKIP_STOP -> {
                val payload = parse<SkipStopPayload>(operation.payloadJson)
                api.skipStop(operation.tripId, payload.stopId, SkipStopRequest(payload.reason))
            }
            PendingOperationType.RECORD_EXPENSE -> {
                val p = parse<RecordExpensePayload>(operation.payloadJson)
                api.recordExpense(
                    operation.tripId,
                    RecordExpenseRequest(p.category, p.amount, p.notes, p.expenseId, p.odometerKm, p.fuelType, p.fullTank, p.litres, p.ratePerLitre, p.paidBy),
                    operation.idempotencyKey,
                )
                p.expenseId?.let { tripRepository.markExpenseSent(it) }
            }
            PendingOperationType.CREATE_REQUEST -> {
                val p = parse<CreateRequestPayload>(operation.payloadJson)
                api.createRequest(CreateDriverRequest(p.requestId, p.kind, p.tripId, p.amount, p.customerId, p.customer, p.reason))
            }
            PendingOperationType.RECORD_COLLECTION -> {
                val payload = parse<RecordCollectionPayload>(operation.payloadJson)
                api.recordCollection(
                    operation.tripId,
                    payload.stopId,
                    RecordCollectionRequest(payload.amount, payload.method, payload.notes, payload.reference, payload.payer, payload.payerName),
                    operation.idempotencyKey,
                )
            }
            PendingOperationType.RECORD_DEPOSIT -> {
                val payload = parse<RecordDepositPayload>(operation.payloadJson)
                api.recordDeposit(
                    operation.tripId,
                    RecordDepositRequest(payload.amount, payload.bankAccount, payload.reference, payload.depositedAt),
                    operation.idempotencyKey,
                )
            }
            PendingOperationType.REPORT_PROBLEM -> {
                val payload = parse<ReportProblemPayload>(operation.payloadJson)
                api.reportProblem(operation.tripId, ReportProblemRequest(payload.kind, payload.note), operation.idempotencyKey)
            }
            PendingOperationType.START_TRIP -> {
                val payload = parse<StartTripPayload>(operation.payloadJson)
                // Only a trip still planned: one already on the road (a pass
                // that timed out after the server had it) needs nothing more.
                val trip = api.getTrip(operation.tripId)
                if (trip.status == "planned") {
                    api.startTrip(
                        operation.tripId,
                        StartTripRequest(trip.version, payload.openingKm, payload.latitude, payload.longitude, payload.accuracyMeters),
                    )
                }
            }
            PendingOperationType.SUBMIT_TRIP -> {
                val payload = parse<SubmitTripPayload>(operation.payloadJson)
                // The server's current version: the owner may have returned
                // the trip since this phone last pulled it.
                val trip = api.getTrip(operation.tripId)
                if (trip.status != "completed") {
                    api.completeTrip(operation.tripId, SubmitTripRequest(trip.version, payload.cashDeclared, payload.note))
                }
            }
        }
    }

    private inline fun <reified T> parse(json: String): T =
        moshi.adapter(T::class.java).fromJson(json) ?: error("Malformed pending-operation payload")

    /** Uploads queued photos — every one, or only one stop's, backhaul's or expense's ([stopId]). */
    private suspend fun pushPhotos(stopId: String? = null): Boolean {
        for (photo in pendingPhotoDao.nextBatch().filter { stopId == null || it.stopId == stopId }) {
            // An expense's bill goes once the expense itself has reached the server (D6); a chat photo once its message has (D9).
            if (photo.target == "expense" && tripRepository.isExpenseUnsent(photo.stopId)) continue
            if (photo.target == "chat" && chatRepository.isUnsent(photo.stopId)) continue
            val file = File(photo.localPath)
            // Gone from the phone (the cache cleared): no pass will ever send it — the driver decides (D8).
            if (!file.exists()) {
                pendingPhotoDao.markFailed(photo.id, "failed_needs_review", "The photo is no longer on this phone")
                return false
            }
            val outcome = runCatching {
                val mediaType = photo.mimeType.toMediaTypeOrNull()
                val body = file.asRequestBody(mediaType)
                val part = MultipartBody.Part.createFormData("file", file.name, body)
                val photoTypeBody = photo.photoType.toRequestBody("text/plain".toMediaTypeOrNull())
                if (photo.target == "chat") {
                    chatRepository.markSent(api.uploadChatPhoto(photo.stopId, part))
                } else if (photo.target == "backhaul") {
                    api.uploadBackhaulPhoto(photo.tripId, photo.stopId, photoTypeBody, part)
                } else if (photo.target == "expense") {
                    api.uploadExpensePhoto(photo.tripId, photo.stopId, photoTypeBody, part)
                } else {
                    val productBody = photo.productId?.toRequestBody("text/plain".toMediaTypeOrNull())
                    api.uploadPhoto(photo.tripId, photo.stopId, photoTypeBody, part, productBody)
                }
            }
            if (outcome.isSuccess) {
                pendingPhotoDao.delete(photo.id)
                // The office has it: off the phone (DRV.13) — but a chat photo, which the conversation shows from here.
                if (photo.target != "chat") file.delete()
                continue
            }
            when (Refusal.classify(outcome.exceptionOrNull())) {
                SendFailure.REFUSED -> pendingPhotoDao.markFailed(photo.id, "failed_needs_review", reasonOf(outcome.exceptionOrNull()))
                SendFailure.READ_ONLY, SendFailure.TRANSIENT -> Unit // kept queued; see pushOperations
            }
            return false
        }
        return true
    }

    /** The server's own words for a refusal ("Opening KM … is below …"), not just "HTTP 400". */
    private fun reasonOf(error: Throwable?): String {
        if (error is retrofit2.HttpException) {
            val body = runCatching { error.response()?.errorBody()?.string() }.getOrNull()
            val message = body?.let { runCatching { org.json.JSONObject(it).optJSONObject("error")?.optString("message") }.getOrNull() }
            if (!message.isNullOrBlank()) return message
        }
        return error?.message ?: "sync failed"
    }

    private companion object {
        // Process-wide, not per instance: WorkManager builds a new engine for each run.
        val passes = Mutex()
    }
}
