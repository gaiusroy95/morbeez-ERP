package com.morbeez.driver.data.repository

import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.local.TripDao
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopDao
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.TripExpenseResponse
import com.morbeez.driver.data.remote.dto.TripStopResponse
import com.morbeez.driver.data.sync.CompleteDeliveryPayload
import com.morbeez.driver.data.sync.CompletePickupPayload
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.data.sync.RecordCollectionPayload
import com.morbeez.driver.data.sync.RecordExpensePayload
import com.morbeez.driver.data.sync.SkipStopPayload
import com.squareup.moshi.Moshi
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * The single door between the UI and both Room and the network — screens
 * never call ApiService directly (Driver App Architecture, DRV.1). Every
 * mutating call here writes to Room and enqueues a PendingOperation in the
 * same breath, then returns immediately; the sync engine is what actually
 * reaches the network.
 */
@Singleton
class TripRepository @Inject constructor(
    private val api: ApiService,
    private val tripDao: TripDao,
    private val stopDao: TripStopDao,
    private val pendingOperationDao: PendingOperationDao,
    private val pendingPhotoDao: PendingPhotoDao,
    private val moshi: Moshi,
) {
    fun observeActiveTrip(): Flow<TripEntity?> = tripDao.observeActiveTrip()
    fun observeStops(tripId: String): Flow<List<TripStopEntity>> = stopDao.observeByTrip(tripId)
    fun observeFailedOperations(): Flow<List<PendingOperationEntity>> = pendingOperationDao.observeFailed()

    suspend fun getStop(stopId: String): TripStopEntity? = stopDao.findById(stopId)
    suspend fun getActiveTrip(): TripEntity? = tripDao.findActiveTrip()

    /**
     * Pulls this driver's current trip and its route from the backend and
     * replaces the local copy — only called once the push side of sync has
     * fully drained (Driver App Architecture, DRV.9), so a pull can never
     * overwrite an action the driver took that hasn't reached the server yet.
     */
    suspend fun refreshMyTrips() {
        val page = api.listMyTrips(status = null, page = 1, pageSize = 5)
        val active = page.items.firstOrNull { it.status == "planned" || it.status == "in_progress" }
        if (active == null) {
            tripDao.clear()
            return
        }

        tripDao.upsert(
            TripEntity(
                id = active.id,
                vehicleId = active.vehicleId,
                vehicleRegistrationNumber = active.vehicleId, // resolved lazily by the UI if needed; kept simple here
                driverEmployeeId = active.driverEmployeeId,
                status = active.status,
                plannedDate = active.plannedDate,
                advanceAmount = active.advanceAmount,
                version = active.version,
            ),
        )

        val stops = api.listStops(active.id)
        val entities = stops.map { toEntity(it) }
        stopDao.clearForTrip(active.id)
        stopDao.upsertAll(entities)
    }

    private suspend fun toEntity(stop: TripStopResponse): TripStopEntity {
        val (counterpartyName, summary) = if (stop.stopType == "pickup") {
            val pickup = runCatching { api.getPickup(stop.pickupId!!) }.getOrNull()
            val farmerName = pickup?.let { runCatching { api.getFarmer(it.farmerId) }.getOrNull()?.name }
            (farmerName ?: "Farmer pickup") to "Purchase order pickup"
        } else {
            val order = runCatching { api.getOrder(stop.orderId!!) }.getOrNull()
            val customerName = order?.let { runCatching { api.getCustomer(it.customerId) }.getOrNull()?.name }
            val lineCount = order?.lines?.size ?: 0
            (customerName ?: "Customer delivery") to "$lineCount item(s)"
        }
        return TripStopEntity(
            id = stop.id,
            tripId = stop.tripId,
            sequenceNumber = stop.sequenceNumber,
            stopType = stop.stopType,
            status = stop.status,
            pickupId = stop.pickupId,
            orderId = stop.orderId,
            counterpartyName = counterpartyName,
            summary = summary,
            notes = stop.notes,
            pendingSync = false,
        )
    }

    // ---- Queuing offline actions (Driver App Architecture, DRV.3) ----

    suspend fun queueCompletePickupStop(tripId: String, stopId: String) {
        enqueue<CompletePickupPayload>(tripId, PendingOperationType.COMPLETE_PICKUP_STOP, CompletePickupPayload(stopId))
        stopDao.updateStatus(stopId, "completed", pendingSync = true)
    }

    suspend fun queueCompleteDeliveryStop(tripId: String, stopId: String, recipientName: String, signatureData: String?) {
        enqueue<CompleteDeliveryPayload>(
            tripId,
            PendingOperationType.COMPLETE_DELIVERY_STOP,
            CompleteDeliveryPayload(stopId, recipientName, signatureData),
        )
        stopDao.updateStatus(stopId, "completed", pendingSync = true)
    }

    suspend fun queueSkipStop(tripId: String, stopId: String) {
        enqueue<SkipStopPayload>(tripId, PendingOperationType.SKIP_STOP, SkipStopPayload(stopId))
        stopDao.updateStatus(stopId, "skipped", pendingSync = true)
    }

    suspend fun queueExpense(tripId: String, category: String, amount: Double, notes: String?) {
        enqueue<RecordExpensePayload>(
            tripId,
            PendingOperationType.RECORD_EXPENSE,
            RecordExpensePayload(category, amount, notes),
        )
    }

    suspend fun queueCollection(tripId: String, stopId: String, amount: Double, method: String, notes: String?) {
        enqueue<RecordCollectionPayload>(
            tripId,
            PendingOperationType.RECORD_COLLECTION,
            RecordCollectionPayload(stopId, amount, method, notes),
        )
    }

    /**
     * A direct online read, not Room — Trip Summary should also show
     * expenses a dispatcher recorded from the web app, and this is only
     * called while reviewing a trip online, not while driving with no
     * signal. It goes through the repository, not straight from a
     * ViewModel, so ApiService still has exactly one caller in this app
     * (Driver App Architecture, DRV.1).
     */
    suspend fun listExpenses(tripId: String): List<TripExpenseResponse> =
        runCatching { api.listExpenses(tripId) }.getOrDefault(emptyList())

    suspend fun queuePhoto(tripId: String, stopId: String, photoType: String, localPath: String, mimeType: String) {
        pendingPhotoDao.insert(
            PendingPhotoEntity(
                id = UUID.randomUUID().toString(),
                tripId = tripId,
                stopId = stopId,
                photoType = photoType,
                localPath = localPath,
                mimeType = mimeType,
                createdAt = System.currentTimeMillis(),
            ),
        )
    }

    private suspend inline fun <reified T> enqueue(tripId: String, type: PendingOperationType, payload: T) {
        val json = moshi.adapter(T::class.java).toJson(payload)
        val sequence = pendingOperationDao.maxSequence() + 1
        pendingOperationDao.insert(
            PendingOperationEntity(
                idempotencyKey = UUID.randomUUID().toString(),
                tripId = tripId,
                operationType = type.name,
                payloadJson = json,
                createdAt = System.currentTimeMillis(),
                sequence = sequence,
            ),
        )
    }
}
