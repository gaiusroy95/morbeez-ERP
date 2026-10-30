package com.morbeez.driver.data.repository

import com.morbeez.driver.data.i18n.AppLanguage
import com.morbeez.driver.R
import dagger.hilt.android.qualifiers.ApplicationContext
import android.content.Context
import com.morbeez.driver.data.local.BackhaulDao
import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.data.local.DriverDayDao
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.FarmDraft
import com.morbeez.driver.data.local.StopDraftDao
import com.morbeez.driver.data.local.StopDraftEntity
import com.morbeez.driver.data.local.DeliveryDraft
import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.local.TripDao
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopDao
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.BackhaulResponse
import com.morbeez.driver.data.remote.dto.HandoverResponse
import com.morbeez.driver.data.remote.dto.TripExpenseResponse
import com.morbeez.driver.data.remote.dto.DriverApprovalsResponse
import com.morbeez.driver.data.remote.dto.DriverProfileResponse
import com.morbeez.driver.data.remote.dto.DriverTripSummaryResponse
import com.morbeez.driver.data.remote.dto.DriverVehicleResponse
import com.morbeez.driver.data.remote.dto.MyExpensesResponse
import com.morbeez.driver.data.remote.dto.MyEarningsResponse
import com.morbeez.driver.data.remote.dto.DriverSettlementResponse
import com.morbeez.driver.data.sync.AcknowledgePayPayload
import com.morbeez.driver.data.remote.dto.TripHistoryResponse
import com.morbeez.driver.data.local.ExpenseDao
import com.morbeez.driver.data.local.ExpenseEntity
import com.morbeez.driver.data.remote.dto.TripVehicleStockResponse
import com.morbeez.driver.data.remote.dto.CrewOptionResponse
import com.morbeez.driver.data.remote.dto.CrateTypeResponse
import com.morbeez.driver.data.remote.dto.DeliveryOutcomeResponse
import com.morbeez.driver.data.remote.dto.CompleteDeliveryRequest
import com.morbeez.driver.data.remote.dto.TripCollectionsResponse
import com.morbeez.driver.data.remote.dto.FarmLineRequest
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.data.remote.dto.TripStopResponse
import com.morbeez.driver.data.remote.dto.DeliveryLineMeasure
import com.morbeez.driver.data.remote.dto.FarmWeight
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.data.sync.ArriveStopPayload
import com.morbeez.driver.data.sync.BackhaulPayload
import com.morbeez.driver.data.sync.BackhaulStepPayload
import com.morbeez.driver.data.sync.CreateBackhaulPayload
import com.morbeez.driver.data.sync.PayBackhaulPayload
import com.morbeez.driver.data.sync.SkipBackhaulPayload
import com.morbeez.driver.data.sync.CompleteDeliveryPayload
import com.morbeez.driver.data.sync.CompletePickupPayload
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.data.sync.PhotoShrinker
import com.morbeez.driver.data.sync.RecordCollectionPayload
import com.morbeez.driver.data.sync.RecordDepositPayload
import com.morbeez.driver.data.sync.RecordExpensePayload
import com.morbeez.driver.data.sync.ReportProblemPayload
import com.morbeez.driver.data.sync.SkipStopPayload
import com.morbeez.driver.data.sync.StartDeliveriesPayload
import com.morbeez.driver.data.sync.RaiseDisputePayload
import com.morbeez.driver.data.sync.ReturnTripPayload
import com.morbeez.driver.data.sync.StartTripPayload
import com.morbeez.driver.data.sync.SubmitTripPayload
import com.squareup.moshi.Moshi
import java.util.Locale
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

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
    private val dayDao: DriverDayDao,
    private val draftDao: StopDraftDao,
    private val backhaulDao: BackhaulDao,
    private val expenseDao: ExpenseDao,
    private val moshi: Moshi,
    @ApplicationContext private val appContext: Context,
) {
    /** Text built here (stop summaries) is in the language chosen on this phone. */
    private val res get() = AppLanguage.wrap(appContext).resources

    fun observeActiveTrip(): Flow<TripEntity?> = tripDao.observeActiveTrip()
    fun observeStops(tripId: String): Flow<List<TripStopEntity>> = stopDao.observeByTrip(tripId)
    fun observeFailedOperations(): Flow<List<PendingOperationEntity>> = pendingOperationDao.observeFailed()
    fun observePendingCount(): Flow<Int> = pendingOperationDao.observePendingCount()
    fun observeDay(): Flow<DriverDayEntity?> = dayDao.observe()
    suspend fun getDay(): DriverDayEntity? = dayDao.find()

    /** What was on the vehicle when the server last answered. */
    fun stockOf(day: DriverDayEntity?): TripVehicleStockResponse? =
        day?.stockJson?.let { runCatching { stockAdapter.fromJson(it) }.getOrNull() }

    private val stockAdapter by lazy { moshi.adapter(TripVehicleStockResponse::class.java) }

    /** The business's workers, to pick a farm's packer and loader from — as the server last listed them. */
    fun crewOf(day: DriverDayEntity?): List<CrewOptionResponse> =
        day?.crewJson?.let { runCatching { crewAdapter.fromJson(it) }.getOrNull() } ?: emptyList()

    private val crewAdapter by lazy {
        moshi.adapter<List<CrewOptionResponse>>(
            com.squareup.moshi.Types.newParameterizedType(List::class.java, CrewOptionResponse::class.java),
        )
    }

    /** A completed farm stop: what was accepted and rejected, and the crew. */
    fun farmOf(stop: TripStopEntity): FarmStopOutcomeResponse? =
        stop.farmJson?.let { runCatching { farmAdapter.fromJson(it) }.getOrNull() }

    private val farmAdapter by lazy { moshi.adapter(FarmStopOutcomeResponse::class.java) }
    private val draftAdapter by lazy { moshi.adapter(FarmDraft::class.java) }

    /** The farm stop being worked on, kept on the phone (D2); null until something is entered. */
    fun observeDraft(stopId: String): Flow<FarmDraft?> =
        draftDao.observe(stopId).map { row -> row?.let { runCatching { draftAdapter.fromJson(it.json) }.getOrNull() } }

    suspend fun saveDraft(tripId: String, stopId: String, draft: FarmDraft) {
        draftDao.upsert(StopDraftEntity(stopId, tripId, draftAdapter.toJson(draft), System.currentTimeMillis()))
    }

    /** The crate types, as the server last listed them. */
    fun crateTypesOf(day: DriverDayEntity?): List<CrateTypeResponse> =
        day?.crateTypesJson?.let { runCatching { crateTypesAdapter.fromJson(it) }.getOrNull() } ?: emptyList()

    private val crateTypesAdapter by lazy {
        moshi.adapter<List<CrateTypeResponse>>(
            com.squareup.moshi.Types.newParameterizedType(List::class.java, CrateTypeResponse::class.java),
        )
    }

    /** A completed delivery: its QR, shortfalls, crates — and, until the server answers, what left the vehicle. */
    fun deliveryOf(stop: TripStopEntity): DeliveryOutcomeResponse? =
        stop.deliveryJson?.let { runCatching { deliveryAdapter.fromJson(it) }.getOrNull() }

    private val deliveryAdapter by lazy { moshi.adapter(DeliveryOutcomeResponse::class.java) }
    private val deliveryDraftAdapter by lazy { moshi.adapter(DeliveryDraft::class.java) }

    /** The delivery being worked on, kept on the phone (D3); null until something is entered. */
    fun observeDeliveryDraft(stopId: String): Flow<DeliveryDraft?> =
        draftDao.observe(stopId).map { row -> row?.let { runCatching { deliveryDraftAdapter.fromJson(it.json) }.getOrNull() } }

    suspend fun saveDeliveryDraft(tripId: String, stopId: String, draft: DeliveryDraft) {
        draftDao.upsert(StopDraftEntity(stopId, tripId, deliveryDraftAdapter.toJson(draft), System.currentTimeMillis()))
    }

    /** The trip's collections, as the server last listed them (D4). */
    fun collectionsOf(day: DriverDayEntity?): TripCollectionsResponse? =
        day?.collectionsJson?.let { runCatching { collectionsAdapter.fromJson(it) }.getOrNull() }

    private val collectionsAdapter by lazy { moshi.adapter(TripCollectionsResponse::class.java) }
    private val collectionPayloadAdapter by lazy { moshi.adapter(RecordCollectionPayload::class.java) }
    private val disputePayloadAdapter by lazy { moshi.adapter(RaiseDisputePayload::class.java) }

    /** Collections recorded on this phone the server hasn't counted yet (D4). */
    fun observeQueuedCollections(): Flow<List<RecordCollectionPayload>> =
        pendingOperationDao.observeByTypes(listOf(PendingOperationType.RECORD_COLLECTION.name)).map { ops ->
            ops.mapNotNull { runCatching { collectionPayloadAdapter.fromJson(it.payloadJson) }.getOrNull() }
        }

    /** Disputes raised on this phone the server hasn't heard of yet (D4). */
    fun observeQueuedDisputes(): Flow<List<RaiseDisputePayload>> =
        pendingOperationDao.observeByTypes(listOf(PendingOperationType.RAISE_DISPUTE.name)).map { ops ->
            ops.mapNotNull { runCatching { disputePayloadAdapter.fromJson(it.payloadJson) }.getOrNull() }
        }

    /** Return (D4): the closing KM on the phone at once; sent when there's signal. */
    suspend fun queueReturn(tripId: String, closingKm: Double) {
        enqueue<ReturnTripPayload>(tripId, PendingOperationType.RETURN_TRIP, ReturnTripPayload(closingKm))
        tripDao.markReturned(tripId, String.format(Locale.ROOT, "%.1f", closingKm), java.time.Instant.now().toString())
    }

    /** A customer disputes part of what they owe (D4): sent to the owner when there's signal. */
    suspend fun queueDispute(tripId: String, stopId: String, amount: Double, reason: String) {
        enqueue<RaiseDisputePayload>(tripId, PendingOperationType.RAISE_DISPUTE, RaiseDisputePayload(stopId, amount, reason.trim()))
    }

    /** Start Trip (D3): the deliveries unlock on the phone at once; the server hears when there's signal. */
    suspend fun queueStartDeliveries(tripId: String) {
        val trip = tripDao.findById(tripId) ?: return
        if (trip.deliveryStartedAt != null) return
        val at = java.time.Instant.now().toString()
        enqueue<StartDeliveriesPayload>(tripId, PendingOperationType.START_DELIVERIES, StartDeliveriesPayload(at))
        tripDao.markDeliveriesStarted(tripId, at)
    }

    /**
     * Hold-to-complete at a shop (D3): the checklist, queued behind the
     * delivery's photos; the stop shows as delivered, with what left the
     * vehicle, straight away, and the draft is let go.
     */
    suspend fun queueCompleteDelivery(tripId: String, stopId: String, request: CompleteDeliveryRequest, outcome: DeliveryOutcomeResponse) {
        enqueue<CompleteDeliveryPayload>(
            tripId,
            PendingOperationType.COMPLETE_DELIVERY_STOP,
            CompleteDeliveryPayload(
                stopId,
                request.recipientName,
                request.signatureData,
                request.lines,
                request.qrToken,
                request.qrNote,
                request.allUnloaded,
                request.crates,
            ),
        )
        stopDao.markDeliveryCompleted(stopId, deliveryAdapter.toJson(outcome))
        draftDao.delete(stopId)
    }

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
     * Pulls this driver's day — today's trip and its route, the vehicle,
     * earnings, vehicle stock — from the backend and replaces the local copy;
     * only called once the push side of sync has fully drained (Driver App
     * Architecture, DRV.9), so a pull can never overwrite an action the
     * driver took that hasn't reached the server yet. The server picks the
     * trip: on the road first, then one planned for today (never a later
     * day: the owner plans first), then a submitted one not yet closed.
     */
    suspend fun refreshMyTrips() {
        val day = api.getMyDay()
        val before = dayDao.find()
        dayDao.upsert(
            DriverDayEntity(
                today = day.today,
                driverName = day.driver?.name,
                vehicleRegistration = day.vehicle?.registrationNumber,
                routeName = day.routeName,
                lastOdometerKm = day.lastOdometerKm,
                weekFrom = day.weekFrom,
                earnedThisWeek = day.earnedThisWeek,
                stockJson = day.vehicleStock?.let { stockAdapter.toJson(it) },
                refreshedAt = System.currentTimeMillis(),
                crewJson = crewAdapter.toJson(day.crew),
                crateTypesJson = crateTypesAdapter.toJson(day.crateTypes),
                // What's owed by the customers delivered so far (D4); kept from the last pull when unreachable.
                collectionsJson = day.trip?.takeIf { it.status == "in_progress" || it.status == "completed" }?.let { t ->
                    runCatching { collectionsAdapter.toJson(api.getTripCollections(t.id)) }.getOrNull()
                        ?: before?.collectionsJson
                },
                // The driver's own records (D6); each kept from the last pull when unreachable.
                approvalsJson = runCatching { approvalsAdapter.toJson(api.getMyApprovals()) }.getOrNull() ?: before?.approvalsJson,
                myExpensesJson = runCatching { myExpensesAdapter.toJson(api.getMyExpenses()) }.getOrNull() ?: before?.myExpensesJson,
                vehicleJson = runCatching { api.getMyVehicle() }.getOrNull()
                    ?.let { v -> v.vehicle?.let { vehicleAdapter.toJson(it) } } ?: before?.vehicleJson,
                profileJson = runCatching { profileAdapter.toJson(api.getMyProfile()) }.getOrNull() ?: before?.profileJson,
                // My Earnings and the week's pay (D7); kept from the last pull when unreachable.
                earningsTodayJson = runCatching { earningsAdapter.toJson(api.getMyEarnings("today")) }.getOrNull() ?: before?.earningsTodayJson,
                earningsWeekJson = runCatching { earningsAdapter.toJson(api.getMyEarnings("week")) }.getOrNull() ?: before?.earningsWeekJson,
                earningsMonthJson = runCatching { earningsAdapter.toJson(api.getMyEarnings("month")) }.getOrNull() ?: before?.earningsMonthJson,
                settlementsJson = runCatching { settlementsAdapter.toJson(api.getMySettlements()) }.getOrNull() ?: before?.settlementsJson,
                // How far the chat is read (D9) is the phone's own: read last, after every call above.
                chatReadAt = dayDao.find()?.chatReadAt,
            ),
        )
        val active = day.trip
        if (active == null) {
            tripDao.clear()
            stopDao.clear()
            draftDao.clear()
            backhaulDao.clear()
            expenseDao.clear()
            return
        }

        tripDao.upsert(
            TripEntity(
                id = active.id,
                vehicleId = active.vehicleId,
                vehicleRegistrationNumber = day.vehicle?.registrationNumber ?: active.vehicleId,
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
                number = active.number.ifBlank { null },
                openingKm = active.openingKm,
                startedAt = active.startedAt,
                deliveryStartedAt = active.deliveryStartedAt,
                closingKm = active.closingKm,
                returnedAt = active.returnedAt,
            ),
        )

        // The server's current trip is the only one this phone keeps (DRV.3).
        tripDao.deleteAllExcept(active.id)
        stopDao.deleteAllExceptTrip(active.id)
        draftDao.deleteAllExceptTrip(active.id)
        backhaulDao.deleteAllExceptTrip(active.id)
        expenseDao.deleteAllExceptTrip(active.id)

        val stops = api.listStops(active.id)
        val entities = stops.map { toEntity(it) }
        stopDao.clearForTrip(active.id)
        stopDao.upsertAll(entities)

        // The trip's backhauls (D5); kept from the last pull when unreachable.
        runCatching { api.listBackhauls(active.id) }.getOrNull()?.let { list ->
            backhaulDao.clearForTrip(active.id)
            backhaulDao.upsertAll(list.map { toEntity(it) })
        }

        // The trip's expenses (D6): the server's list, the bills still on this phone counted with them.
        runCatching { api.listExpenses(active.id) }.getOrNull()?.let { list ->
            val unsentBills = pendingPhotoDao.nextBatch().filter { it.target == "expense" }.groupingBy { it.stopId }.eachCount()
            expenseDao.clearSyncedForTrip(active.id)
            expenseDao.upsertAll(list.map { toEntity(it, unsentBills[it.id] ?: 0) })
        }
    }

    private fun toEntity(e: TripExpenseResponse, unsentBills: Int) = ExpenseEntity(
        id = e.id,
        tripId = e.tripId,
        category = e.category,
        amount = e.amount,
        notes = e.notes,
        recordedAt = e.recordedAt,
        odometerKm = e.fuel?.odometerKm,
        fuelType = e.fuel?.fuelType,
        fullTank = e.fuel?.fullTank,
        litres = e.fuel?.litres,
        ratePerLitre = e.fuel?.ratePerLitre,
        needsApproval = e.needsApproval,
        decision = e.decision,
        decisionNote = e.decisionNote,
        photos = e.photos + unsentBills,
    )

    // ---- The driver's own records (D6) ----

    private val approvalsAdapter by lazy { moshi.adapter(DriverApprovalsResponse::class.java) }
    private val myExpensesAdapter by lazy { moshi.adapter(MyExpensesResponse::class.java) }
    private val vehicleAdapter by lazy { moshi.adapter(DriverVehicleResponse::class.java) }
    private val profileAdapter by lazy { moshi.adapter(DriverProfileResponse::class.java) }

    /** What the driver raised that the owner decides, as the server last listed it. */
    fun approvalsOf(day: DriverDayEntity?): DriverApprovalsResponse? = day?.approvalsJson?.let { runCatching { approvalsAdapter.fromJson(it) }.getOrNull() }

    /** The last 30 days' expenses and the vehicle's mileage, as the server last listed them. */
    fun myExpensesOf(day: DriverDayEntity?): MyExpensesResponse? = day?.myExpensesJson?.let { runCatching { myExpensesAdapter.fromJson(it) }.getOrNull() }

    fun vehicleOf(day: DriverDayEntity?): DriverVehicleResponse? = day?.vehicleJson?.let { runCatching { vehicleAdapter.fromJson(it) }.getOrNull() }

    fun profileOf(day: DriverDayEntity?): DriverProfileResponse? = day?.profileJson?.let { runCatching { profileAdapter.fromJson(it) }.getOrNull() }

    // ---- Earnings and pay (D7) ----

    private val earningsAdapter by lazy { moshi.adapter(MyEarningsResponse::class.java) }
    private val settlementsAdapter by lazy {
        moshi.adapter<List<DriverSettlementResponse>>(com.squareup.moshi.Types.newParameterizedType(List::class.java, DriverSettlementResponse::class.java))
    }

    /** My Earnings for today | week | month, as the server last worked it out. */
    fun earningsOf(day: DriverDayEntity?, period: String): MyEarningsResponse? =
        when (period) {
            "today" -> day?.earningsTodayJson
            "month" -> day?.earningsMonthJson
            else -> day?.earningsWeekJson
        }?.let { runCatching { earningsAdapter.fromJson(it) }.getOrNull() }

    fun settlementsOf(day: DriverDayEntity?): List<DriverSettlementResponse>? = day?.settlementsJson?.let { runCatching { settlementsAdapter.fromJson(it) }.getOrNull() }

    /** Settlements this phone has said were received, not sent yet. */
    fun observeQueuedAcknowledgements(): Flow<Set<String>> =
        pendingOperationDao.observeByTypes(listOf(PendingOperationType.ACKNOWLEDGE_PAY.name)).map { ops ->
            ops.mapNotNull { runCatching { moshi.adapter(AcknowledgePayPayload::class.java).fromJson(it.payloadJson)?.settlementId }.getOrNull() }.toSet()
        }

    /** "I received it": queued, sent when there's signal. */
    suspend fun queueAcknowledgePay(settlementId: String) {
        enqueue<AcknowledgePayPayload>("", PendingOperationType.ACKNOWLEDGE_PAY, AcknowledgePayPayload(settlementId))
    }

    /** Past trips — a direct online read (they're not kept on the phone); null with no signal. */
    suspend fun fetchHistory(from: String?, to: String?): TripHistoryResponse? = runCatching { api.getMyHistory(from, to) }.getOrNull()

    /** One trip in full — online; null with no signal. */
    suspend fun fetchTripSummary(tripId: String): DriverTripSummaryResponse? = runCatching { api.getTripSummary(tripId) }.getOrNull()

    fun observeExpenses(tripId: String): Flow<List<ExpenseEntity>> = expenseDao.observeByTrip(tripId)

    /**
     * An expense on the road: on the phone at once, sent when there's signal.
     * Its id is the phone's own, so the bill photo follows it.
     */
    suspend fun queueExpense(tripId: String, expense: NewExpense): String {
        val id = UUID.randomUUID().toString()
        val note = expense.notes?.trim()?.ifBlank { null }
        val fuel = expense.fuel?.takeIf { expense.category == "fuel" }
        expenseDao.upsert(
            ExpenseEntity(
                id = id,
                tripId = tripId,
                category = expense.category,
                amount = String.format(Locale.ROOT, "%.2f", expense.amount),
                notes = note,
                recordedAt = java.time.Instant.now().toString(),
                odometerKm = fuel?.odometerKm,
                fuelType = fuel?.fuelType,
                fullTank = fuel?.fullTank,
                litres = fuel?.litres?.let { String.format(Locale.ROOT, "%.3f", it) },
                ratePerLitre = fuel?.ratePerLitre?.let { String.format(Locale.ROOT, "%.2f", it) },
                pendingSync = true,
            ),
        )
        enqueue<RecordExpensePayload>(
            tripId,
            PendingOperationType.RECORD_EXPENSE,
            RecordExpensePayload(expense.category, expense.amount, note, id, fuel?.odometerKm, fuel?.fuelType, fuel?.fullTank, fuel?.litres, fuel?.ratePerLitre),
        )
        return id
    }

    /** The bill: queued for upload once its expense has reached the server, counted at once. */
    suspend fun queueExpensePhoto(tripId: String, expenseId: String, localPath: String, mimeType: String) {
        if (mimeType == "image/jpeg") PhotoShrinker.shrink(localPath)
        pendingPhotoDao.insert(
            PendingPhotoEntity(
                id = UUID.randomUUID().toString(),
                tripId = tripId,
                stopId = expenseId,
                photoType = "bill",
                localPath = localPath,
                mimeType = mimeType,
                createdAt = System.currentTimeMillis(),
                target = "expense",
            ),
        )
        expenseDao.find(expenseId)?.let { expenseDao.upsert(it.copy(photos = it.photos + 1)) }
    }

    /** The server has the expense: its bill can follow. */
    suspend fun markExpenseSent(expenseId: String) {
        expenseDao.find(expenseId)?.let { expenseDao.upsert(it.copy(pendingSync = false)) }
    }

    suspend fun isExpenseUnsent(expenseId: String): Boolean = expenseDao.find(expenseId)?.pendingSync == true

    private fun toEntity(b: BackhaulResponse) = BackhaulEntity(
        id = b.id,
        tripId = b.tripId,
        pickupPlace = b.pickupPlace,
        dropPlace = b.dropPlace,
        rent = b.rent,
        hirerName = b.hirerName,
        notes = b.notes,
        offeredBy = b.offeredBy,
        status = b.status,
        skipReason = b.skipReason,
        acceptedAt = b.acceptedAt,
        pickupReachedAt = b.pickupReachedAt,
        loadedAt = b.loadedAt,
        dropReachedAt = b.dropReachedAt,
        completedAt = b.completedAt,
        paymentMethod = b.payment?.method,
        amountReceived = b.payment?.amount,
        paymentReference = b.payment?.reference,
        paidAt = b.payment?.paidAt,
        loadPhotos = b.photos.load,
        dropPhotos = b.photos.drop,
        paymentPhotos = b.photos.payment,
        createdAt = b.createdAt,
    )

    // ---- Backhaul (D5): on the phone at once, sent when there's signal ----

    fun observeBackhauls(tripId: String): Flow<List<BackhaulEntity>> = backhaulDao.observeByTrip(tripId)

    /** One the driver took on the road: accepted as it's added; the owner is told. */
    suspend fun queueAddBackhaul(tripId: String, pickupPlace: String, dropPlace: String, rent: Double, hirerName: String?, notes: String?): String {
        val id = UUID.randomUUID().toString()
        val now = java.time.Instant.now().toString()
        val hirer = hirerName?.trim()?.ifBlank { null }
        val note = notes?.trim()?.ifBlank { null }
        backhaulDao.upsert(
            BackhaulEntity(
                id = id,
                tripId = tripId,
                pickupPlace = pickupPlace.trim(),
                dropPlace = dropPlace.trim(),
                rent = String.format(Locale.ROOT, "%.2f", rent),
                hirerName = hirer,
                notes = note,
                offeredBy = "driver",
                status = "accepted",
                acceptedAt = now,
                createdAt = now,
                pendingSync = true,
            ),
        )
        enqueue<CreateBackhaulPayload>(tripId, PendingOperationType.CREATE_BACKHAUL, CreateBackhaulPayload(id, pickupPlace.trim(), dropPlace.trim(), rent, hirer, note))
        return id
    }

    suspend fun queueAcceptBackhaul(tripId: String, backhaulId: String) {
        val b = backhaulDao.find(backhaulId)?.takeIf { it.status == "offered" } ?: return
        backhaulDao.upsert(b.copy(status = "accepted", acceptedAt = java.time.Instant.now().toString(), pendingSync = true))
        enqueue<BackhaulPayload>(tripId, PendingOperationType.ACCEPT_BACKHAUL, BackhaulPayload(backhaulId))
    }

    /** [reason]: why not — the owner hears. */
    suspend fun queueSkipBackhaul(tripId: String, backhaulId: String, reason: String) {
        val b = backhaulDao.find(backhaulId)?.takeIf { it.status == "offered" } ?: return
        backhaulDao.upsert(b.copy(status = "skipped", skipReason = reason.trim(), pendingSync = true))
        enqueue<SkipBackhaulPayload>(tripId, PendingOperationType.SKIP_BACKHAUL, SkipBackhaulPayload(backhaulId, reason.trim()))
    }

    /** pickup_reached | loaded | drop_reached | completed — at this phone's time. */
    suspend fun queueBackhaulStep(tripId: String, backhaulId: String, step: String) {
        val b = backhaulDao.find(backhaulId)?.takeIf { it.status == "accepted" } ?: return
        val at = java.time.Instant.now().toString()
        val after = when (step) {
            "pickup_reached" -> b.copy(pickupReachedAt = at)
            "loaded" -> b.copy(loadedAt = at)
            "drop_reached" -> b.copy(dropReachedAt = at)
            "completed" -> b.copy(completedAt = at, status = "completed")
            else -> return
        }
        backhaulDao.upsert(after.copy(pendingSync = true))
        enqueue<BackhaulStepPayload>(tripId, PendingOperationType.BACKHAUL_STEP, BackhaulStepPayload(backhaulId, step, at))
    }

    /** The load, the drop or the payment proof: queued for upload, counted at once. */
    suspend fun queueBackhaulPhoto(tripId: String, backhaulId: String, photoType: String, localPath: String, mimeType: String) {
        if (mimeType == "image/jpeg") PhotoShrinker.shrink(localPath)
        pendingPhotoDao.insert(
            PendingPhotoEntity(
                id = UUID.randomUUID().toString(),
                tripId = tripId,
                stopId = backhaulId,
                photoType = photoType,
                localPath = localPath,
                mimeType = mimeType,
                createdAt = System.currentTimeMillis(),
                target = "backhaul",
            ),
        )
        val b = backhaulDao.find(backhaulId) ?: return
        backhaulDao.upsert(
            when (photoType) {
                "load" -> b.copy(loadPhotos = b.loadPhotos + 1)
                "drop" -> b.copy(dropPhotos = b.dropPhotos + 1)
                else -> b.copy(paymentPhotos = b.paymentPhotos + 1)
            },
        )
    }

    /** What the hirer paid: cash is part of the handover; UPI and transfers went straight to the business. */
    suspend fun queuePayBackhaul(tripId: String, backhaulId: String, method: String, amount: Double, reference: String?, note: String?) {
        val b = backhaulDao.find(backhaulId)?.takeIf { it.status == "completed" && it.paidAt == null } ?: return
        val at = java.time.Instant.now().toString()
        val ref = reference?.trim()?.ifBlank { null }?.takeIf { method != "cash" }
        backhaulDao.upsert(
            b.copy(paymentMethod = method, amountReceived = String.format(Locale.ROOT, "%.2f", amount), paymentReference = ref, paidAt = at, pendingSync = true),
        )
        enqueue<PayBackhaulPayload>(tripId, PendingOperationType.PAY_BACKHAUL, PayBackhaulPayload(backhaulId, method, amount, ref, note?.trim()?.ifBlank { null }, at))
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
            partyPhone = stop.party?.phone?.ifBlank { null },
            partyPlace = stop.party?.place?.ifBlank { null },
            partyAddress = stop.party?.address?.ifBlank { null },
            partyLatitude = stop.party?.latitude?.toDoubleOrNull(),
            partyLongitude = stop.party?.longitude?.toDoubleOrNull(),
            arrivedAt = stop.arrivedAt,
            farmJson = stop.farm?.let { farmAdapter.toJson(it) },
            partyQrToken = stop.party?.qrToken,
            deliveryJson = stop.delivery?.let { deliveryAdapter.toJson(it) },
        )
    }

    // ---- Queuing offline actions (Driver App Architecture, DRV.3) ----

    /**
     * Start Day: the trip is on the road on this phone at once; the server
     * hears with the opening KM and where the phone was ([latitude] and
     * [longitude] both, or neither).
     */
    suspend fun queueStartDay(tripId: String, openingKm: Double, latitude: Double?, longitude: Double?, accuracyMeters: Double?) {
        enqueue<StartTripPayload>(tripId, PendingOperationType.START_TRIP, StartTripPayload(openingKm, latitude, longitude, accuracyMeters))
        tripDao.markStarted(tripId, String.format(Locale.ROOT, "%.1f", openingKm), java.time.Instant.now().toString())
    }

    /** Start pickup (D2): the driver reached the farm — on the phone at once, sent when there's signal. */
    suspend fun queueArrive(tripId: String, stopId: String) {
        val stop = stopDao.findById(stopId) ?: return
        if (stop.arrivedAt != null) return
        enqueue<ArriveStopPayload>(tripId, PendingOperationType.ARRIVE_STOP, ArriveStopPayload(stopId))
        stopDao.markArrived(stopId, java.time.Instant.now().toString())
    }

    /**
     * Hold-to-complete at a farm (D2): every product accepted or rejected
     * and the crew, queued behind the farm's photos; the stop shows as done
     * with what was loaded straight away, and the draft is let go.
     */
    suspend fun queueCompleteFarmStop(
        tripId: String,
        stopId: String,
        lines: List<FarmLineRequest>,
        packerId: String?,
        loaderId: String?,
        outcome: FarmStopOutcomeResponse,
    ) {
        enqueue<CompletePickupPayload>(
            tripId,
            PendingOperationType.COMPLETE_PICKUP_STOP,
            CompletePickupPayload(stopId, lines = lines, packerEmployeeId = packerId, loaderEmployeeId = loaderId),
        )
        stopDao.markFarmCompleted(stopId, farmAdapter.toJson(outcome))
        draftDao.delete(stopId)
    }

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

    /**
     * Start Day refused (the opening KM below the vehicle's last reading,
     * read since this phone last synced): the driver reads the odometer again
     * and it's sent in its place in the queue, ahead of what came after it.
     */
    suspend fun correctStartDay(operation: PendingOperationEntity, openingKm: Double) {
        val adapter = moshi.adapter(StartTripPayload::class.java)
        val payload = adapter.fromJson(operation.payloadJson) ?: return
        pendingOperationDao.retryWith(operation.idempotencyKey, adapter.toJson(payload.copy(openingKm = openingKm)))
        tripDao.setOpeningKm(operation.tripId, String.format(Locale.ROOT, "%.1f", openingKm))
    }

    /** The driver can't go on, the trip can't proceed, something's wrong: queued like everything else, sent at once when there's signal. */
    suspend fun queueProblem(tripId: String, kind: String, note: String) {
        enqueue<ReportProblemPayload>(tripId, PendingOperationType.REPORT_PROBLEM, ReportProblemPayload(kind, note.trim()))
    }

    /** What the driver should hand over, worked out by the server — null when offline. */
    suspend fun getHandover(tripId: String): HandoverResponse? = runCatching { api.getHandover(tripId) }.getOrNull()

    /** [payerName]: someone paying on the customer's behalf (D4); [reference]: a UPI or transfer's UTR. */
    suspend fun queueCollection(
        tripId: String,
        stopId: String,
        amount: Double,
        method: String,
        notes: String?,
        reference: String? = null,
        payerName: String? = null,
    ) {
        enqueue<RecordCollectionPayload>(
            tripId,
            PendingOperationType.RECORD_COLLECTION,
            RecordCollectionPayload(
                stopId,
                amount,
                method,
                notes,
                reference = reference?.trim()?.ifBlank { null },
                payer = if (payerName.isNullOrBlank()) "customer" else "third_party",
                payerName = payerName?.trim()?.ifBlank { null },
            ),
        )
    }

    /** [productId]: a farm stop's rejection photo names the product it shows. */
    suspend fun queuePhoto(tripId: String, stopId: String, photoType: String, localPath: String, mimeType: String, productId: String? = null) {
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
                productId = productId,
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

/** What the driver records on New Expense (D6); [fuel] only for fuel. */
data class NewExpense(val category: String, val amount: Double, val notes: String?, val fuel: FuelDetails? = null)

/** At the pump: the odometer, the fuel, full tank or not, litres and the rate. */
data class FuelDetails(val odometerKm: Int, val fuelType: String, val fullTank: Boolean, val litres: Double, val ratePerLitre: Double)
