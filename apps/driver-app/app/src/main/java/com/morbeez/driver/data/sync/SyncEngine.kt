package com.morbeez.driver.data.sync

import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.CompleteDeliveryRequest
import com.morbeez.driver.data.remote.dto.CompletePickupRequest
import com.morbeez.driver.data.remote.dto.RecordCollectionRequest
import com.morbeez.driver.data.remote.dto.RecordDepositRequest
import com.morbeez.driver.data.remote.dto.RecordExpenseRequest
import com.morbeez.driver.data.remote.dto.ReportProblemRequest
import com.morbeez.driver.data.remote.dto.SkipStopRequest
import com.morbeez.driver.data.remote.dto.SubmitTripRequest
import com.morbeez.driver.data.repository.TripRepository
import com.squareup.moshi.Moshi
import java.io.File
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
    private val moshi: Moshi,
) {
    suspend fun sync(): SyncResult = passes.withLock {
        // One pass at a time across every trigger — periodic, app opened,
        // Refresh — so two never race to send the same queued action
        // (Performance Audit PA-11).
        val operationsDrained = pushOperations()

        // Push before pull (DRV.9) is about actions: a pull must never land
        // on top of one the server hasn't seen. Photos change no state a pull
        // could overwrite, so the route comes down first and the (slow)
        // photo uploads follow (PA-12).
        if (operationsDrained) {
            runCatching { tripRepository.refreshMyTrips() }
        }
        val photosDrained = pushPhotos()

        return@withLock if (operationsDrained && photosDrained) SyncResult.SUCCESS else SyncResult.PARTIAL
    }

    private suspend fun pushOperations(): Boolean {
        for (operation in pendingOperationDao.nextBatch()) {
            val outcome = runCatching { applyOperation(operation) }
            if (outcome.isSuccess) {
                pendingOperationDao.delete(operation.idempotencyKey)
            } else if (isReadOnlyAccount(outcome.exceptionOrNull())) {
                // The business's free trial has ended (402): nothing is wrong
                // with this action. Keep it queued, as it is, and send it once
                // the business subscribes.
                return false
            } else {
                pendingOperationDao.markFailed(
                    operation.idempotencyKey,
                    "failed_needs_review",
                    outcome.exceptionOrNull()?.message ?: "sync failed",
                )
                return false
            }
        }
        return true
    }

    private suspend fun applyOperation(operation: PendingOperationEntity) {
        when (PendingOperationType.valueOf(operation.operationType)) {
            PendingOperationType.COMPLETE_PICKUP_STOP -> {
                val payload = parse<CompletePickupPayload>(operation.payloadJson)
                api.completePickupStop(operation.tripId, payload.stopId, CompletePickupRequest(payload.weights))
            }
            PendingOperationType.COMPLETE_DELIVERY_STOP -> {
                val payload = parse<CompleteDeliveryPayload>(operation.payloadJson)
                // The stop's own photos first: the owner may require a photo of
                // the customer's scale before a customer weight is accepted.
                if (!pushPhotos(payload.stopId)) error("The delivery's photos haven't uploaded yet")
                api.completeDeliveryStop(
                    operation.tripId,
                    payload.stopId,
                    CompleteDeliveryRequest(payload.recipientName, payload.signatureData, payload.lines),
                )
            }
            PendingOperationType.SKIP_STOP -> {
                val payload = parse<SkipStopPayload>(operation.payloadJson)
                api.skipStop(operation.tripId, payload.stopId, SkipStopRequest(payload.reason))
            }
            PendingOperationType.RECORD_EXPENSE -> {
                val payload = parse<RecordExpensePayload>(operation.payloadJson)
                api.recordExpense(
                    operation.tripId,
                    RecordExpenseRequest(payload.category, payload.amount, payload.notes),
                    operation.idempotencyKey,
                )
            }
            PendingOperationType.RECORD_COLLECTION -> {
                val payload = parse<RecordCollectionPayload>(operation.payloadJson)
                api.recordCollection(
                    operation.tripId,
                    payload.stopId,
                    RecordCollectionRequest(payload.amount, payload.method, payload.notes),
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

    /** Uploads queued photos — every one, or only one stop's ([stopId]). */
    private suspend fun pushPhotos(stopId: String? = null): Boolean {
        for (photo in pendingPhotoDao.nextBatch().filter { stopId == null || it.stopId == stopId }) {
            val outcome = runCatching {
                val file = File(photo.localPath)
                val mediaType = photo.mimeType.toMediaTypeOrNull()
                val body = file.asRequestBody(mediaType)
                val part = MultipartBody.Part.createFormData("file", file.name, body)
                val photoTypeBody = photo.photoType.toRequestBody("text/plain".toMediaTypeOrNull())
                api.uploadPhoto(photo.tripId, photo.stopId, photoTypeBody, part)
            }
            if (outcome.isSuccess) {
                pendingPhotoDao.delete(photo.id)
            } else if (isReadOnlyAccount(outcome.exceptionOrNull())) {
                return false // kept queued; see pushOperations
            } else {
                pendingPhotoDao.updateStatus(photo.id, "failed_needs_review")
                return false
            }
        }
        return true
    }

    private fun isReadOnlyAccount(error: Throwable?): Boolean =
        error is retrofit2.HttpException && error.code() == 402

    private companion object {
        // Process-wide, not per instance: WorkManager builds a new engine for each run.
        val passes = Mutex()
    }
}
