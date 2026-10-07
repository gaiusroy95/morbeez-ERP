package com.morbeez.driver.data.repository

import com.morbeez.driver.data.i18n.AppLanguage
import com.morbeez.driver.R
import dagger.hilt.android.qualifiers.ApplicationContext
import android.content.Context
import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.local.TripDao
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopDao
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.HandoverResponse
import com.morbeez.driver.data.remote.dto.TripExpenseResponse
import com.morbeez.driver.data.remote.dto.TripStopResponse
import com.morbeez.driver.data.remote.dto.DeliveryLineMeasure
import com.morbeez.driver.data.remote.dto.FarmWeight
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.data.sync.CompleteDeliveryPayload
import com.morbeez.driver.data.sync.CompletePickupPayload
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.data.sync.PhotoShrinker
import com.morbeez.driver.data.sync.RecordCollectionPayload
import com.morbeez.driver.data.sync.RecordDepositPayload
import com.morbeez.driver.data.sync.RecordExpensePayload
import com.morbeez.driver.data.sync.ReportProblemPayload
import com.morbeez.driver.data.sync.SkipStopPayload
import com.morbeez.driver.data.sync.SubmitTripPayload
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
    @ApplicationContext private val appContext: Context,
) {
    /** Text built here (stop summaries) is in the language chosen on this phone. */
    private val res get() = AppLanguage.wrap(appContext).resources

    fun observeActiveTrip(): Flow<TripEntity?> = tripDao.observeActiveTrip()
    fun observeStops(tripId: String): Flow<List<TripStopEntity>> = stopDao.observeByTrip(tripId)
    fun observeFailedOperations(): Flow<List<PendingOperationEntity>> = pendingOperationDao.observeFailed()
    fun observePendingCount(): Flow<Int> = pendingOperationDao.observePendingCount()

    suspend fun getStop(stopId: String): TripStopEntity? = stopDao.findById(stopId)

    /** The stop's lines (what's weighed or counted there), from the copy kept on the phone. */
    fun itemsOf(stop: TripStopEntity): List<StopItemResponse> =
        stop.itemsJson?.let { runCatching { itemsAdapter.fromJson(it) }.getOrNull() } ?: emptyList()

    private val itemsAdapter by lazy {
        moshi.adapter<List<StopItemResponse>>(
            com.squareup.moshi.Types.newParameterizedType(List::class.java, StopItemResponse::class.java),
        )
    }
    suspend fun getActiveTrip(): TripEntity? = tripDao.findActiveTrip()

    /**
     * Pulls this driver's current trip and its route from the backend and
     * replaces the local copy — only called once the push side of sync has
     * fully drained (Driver App Architecture, DRV.9), so a pull can never
     * overwrite an action the driver took that hasn't reached the server yet.
     */
    suspend fun refreshMyTrips() {
        val page = api.listMyTrips(status = null, page = 1, pageSize = 5)
        // On the road first; otherwise a submitted trip the owner hasn't closed yet.
        val active = page.items.firstOrNull { it.status == "in_progress" }
            ?: page.items.firstOrNull { it.status == "planned" }
            ?: page.items.firstOrNull { it.status == "completed" || it.status == "on_hold" }
        if (active == null) {
            tripDao.clear()
            stopDao.clear()
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
                reviewNote = active.reviewNote,
                cashDeclared = active.cashDeclared,
                // What the owner has authorized on this trip; kept from the last pull when unreachable.
                authorityLevel = runCatching { api.getAuthority(active.id).level }.getOrNull()
                    ?: tripDao.findActiveTrip()?.takeIf { it.id == active.id }?.authorityLevel,
            ),
        )

        // The server's current trip is the only one this phone keeps (DRV.3).
        tripDao.deleteAllExcept(active.id)
        stopDao.deleteAllExceptTrip(active.id)

        val stops = api.listStops(active.id)
        val entities = stops.map { toEntity(it) }
        stopDao.clearForTrip(active.id)
        stopDao.upsertAll(entities)
    }

    /** "40 kg"; eggs as trays and eggs: "9 trays (270 eggs)". */
    private fun quantityLabel(item: StopItemResponse): String {
        val q = item.quantity.trimEnd('0').trimEnd('.')
        val pack = item.packSize
        if (item.kind != "egg" || pack == null || pack <= 0) return "$q ${item.uom}"
        val pieces = item.quantity.toDoubleOrNull()?.toLong() ?: return "$q ${res.getString(R.string.eggs)}"
        val trays = (pieces / pack).toInt()
        val loose = (pieces % pack).toInt()
        val trayText = if (trays > 0) res.getQuantityString(R.plurals.trays, trays, trays) else ""
        val looseText = if (loose > 0) res.getQuantityString(R.plurals.loose_eggs, loose, loose) else ""
        return listOf(trayText, looseText).filter { it.isNotEmpty() }.joinToString(" + ") +
            if (trays > 0) " " + res.getString(R.string.eggs_total, pieces.toInt()) else ""
    }

    private fun toEntity(stop: TripStopResponse): TripStopEntity {
        val counterpartyName = stop.party?.name
            ?: res.getString(if (stop.stopType == "pickup") R.string.farmer_pickup else R.string.customer_delivery)
        val summary = when {
            stop.items.isEmpty() -> res.getString(if (stop.stopType == "pickup") R.string.po_pickup else R.string.no_items)
            else -> {
                val shown = stop.items.take(3).joinToString(", ") { "${it.productName} ${quantityLabel(it)}" }
                if (stop.items.size > 3) res.getString(R.string.and_n_more, shown, stop.items.size - 3) else shown
            }
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
            collectTerms = stop.collect?.terms,
            collectAmount = stop.collect?.amount,
            itemsJson = itemsAdapter.toJson(stop.items),
        )
    }

    // ---- Queuing offline actions (Driver App Architecture, DRV.3) ----

    /** [weights]: the farm weighment, net per product — it receives the goods (the purchase weight). */
    suspend fun queueCompletePickupStop(tripId: String, stopId: String, weights: List<FarmWeight> = emptyList()) {
        enqueue<CompletePickupPayload>(tripId, PendingOperationType.COMPLETE_PICKUP_STOP, CompletePickupPayload(stopId, weights))
        stopDao.updateStatus(stopId, "completed", pendingSync = true)
    }

    /** [lines]: customer-end measures — the customer's scale for live birds, broken eggs — each settles its line. */
    suspend fun queueCompleteDeliveryStop(
        tripId: String,
        stopId: String,
        recipientName: String,
        signatureData: String?,
        lines: List<DeliveryLineMeasure> = emptyList(),
    ) {
        enqueue<CompleteDeliveryPayload>(
            tripId,
            PendingOperationType.COMPLETE_DELIVERY_STOP,
            CompleteDeliveryPayload(stopId, recipientName, signatureData, lines),
        )
        stopDao.updateStatus(stopId, "completed", pendingSync = true)
    }

    /** [reason]: why it wasn't done — the owner hears at once (a customer rejection or a missed pickup). */
    suspend fun queueSkipStop(tripId: String, stopId: String, reason: String? = null) {
        enqueue<SkipStopPayload>(tripId, PendingOperationType.SKIP_STOP, SkipStopPayload(stopId, reason?.trim()?.ifBlank { null }))
        stopDao.updateStatus(stopId, "skipped", pendingSync = true)
    }

    suspend fun queueExpense(tripId: String, category: String, amount: Double, notes: String?) {
        enqueue<RecordExpensePayload>(
            tripId,
            PendingOperationType.RECORD_EXPENSE,
            RecordExpensePayload(category, amount, notes),
        )
    }

    /** Cash paid into the bank on the road: it no longer has to be handed over. */
    suspend fun queueDeposit(tripId: String, amount: Double, bankAccount: String, reference: String) {
        enqueue<RecordDepositPayload>(
            tripId,
            PendingOperationType.RECORD_DEPOSIT,
            RecordDepositPayload(amount, bankAccount, reference, java.time.Instant.now().toString()),
        )
    }

    /**
     * The driver submits the trip for the owner's reconciliation, saying how
     * much cash they're handing over. Queued behind everything recorded on
     * the trip before it (DRV.7), so the owner sees the whole trip.
     */
    suspend fun queueSubmitTrip(tripId: String, cashDeclared: Double?, note: String?) {
        enqueue<SubmitTripPayload>(tripId, PendingOperationType.SUBMIT_TRIP, SubmitTripPayload(cashDeclared, note))
        tripDao.markSubmitted(tripId, cashDeclared?.let { "%.2f".format(it) })
    }

    /** The driver can't go on, the trip can't proceed, something's wrong: queued like everything else, sent at once when there's signal. */
    suspend fun queueProblem(tripId: String, kind: String, note: String) {
        enqueue<ReportProblemPayload>(tripId, PendingOperationType.REPORT_PROBLEM, ReportProblemPayload(kind, note.trim()))
    }

    /** What the driver should hand over, worked out by the server — null when offline. */
    suspend fun getHandover(tripId: String): HandoverResponse? = runCatching { api.getHandover(tripId) }.getOrNull()

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
        if (mimeType == "image/jpeg") PhotoShrinker.shrink(localPath)
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
