package com.morbeez.driver.data.remote.dto

// Field names match the backend's JSON responses exactly (its entity
// records already serialize as camelCase) — no @Json remapping needed.

// deviceId lets the owner revoke this phone's session on its own if it's lost (DRV.11).
/** [login]: a mobile number in any common Indian format, or an email. */
data class LoginRequest(val login: String, val password: String, val deviceId: String? = null)
data class RefreshRequest(val refreshToken: String)

/** Signing in again on this phone with the PIN set here — it works on no other phone. */
data class PinLoginRequest(val login: String, val deviceId: String, val pin: String)
data class SetPinRequest(val deviceId: String, val pin: String)
data class SetPinResponse(val deviceId: String)

/** The language the apps speak to this person in: en, ml, kn or ta. */
data class PreferencesBody(val language: String)

// A login is a phone, an email, or both.
data class PublicUserResponse(val id: String, val email: String?, val phone: String?, val status: String)
data class TokenPairResponse(
    val accessToken: String,
    val refreshToken: String,
    val user: PublicUserResponse,
)

data class PagedResponse<T>(val items: List<T>, val total: Int, val page: Int, val pageSize: Int)

data class TripResponse(
    val id: String,
    val vehicleId: String,
    val driverEmployeeId: String,
    val status: String,
    val plannedDate: String?,
    val advanceAmount: String,
    val startedAt: String?,
    val completedAt: String?,
    val version: Int,
    val reviewNote: String? = null,
    val cashDeclared: String? = null,
    /** "T-20261028-001". */
    val number: String = "",
    /** The odometer when the day started. */
    val openingKm: String? = null,
    /** Start Trip (D3): when the delivery run set off. */
    val deliveryStartedAt: String? = null,
    /** Return (D4): the odometer when back, and when. */
    val closingKm: String? = null,
    val returnedAt: String? = null,
)

/** Return (D4): the closing KM. */
data class ReturnTripRequest(val closingKm: Double)

/** A customer disputing part of what they owe (D4): it goes to the owner. */
data class RaiseDisputeRequest(val amount: Double, val reason: String)

data class InvoiceDisputeResponse(val id: String, val status: String = "open", val amount: String = "0.00")

/** The trip's collections (D4): the customers delivered on it, each with what they owe in all. */
data class TripCollectionsResponse(
    val tripId: String,
    val customers: List<CollectionCustomerResponse> = emptyList(),
    val collected: CollectedTotals = CollectedTotals(),
    val pending: PendingTotals = PendingTotals(),
)

data class CollectionCustomerResponse(
    val customerId: String,
    val name: String,
    val phone: String? = null,
    val place: String? = null,
    val stopId: String,
    /** cash | credit */
    val terms: String = "credit",
    val outstanding: String = "0.00",
    val disputed: String = "0.00",
    val collectedOnTrip: String = "0.00",
)

data class CollectedTotals(
    val cash: String = "0.00",
    val upi: String = "0.00",
    val bankTransfer: String = "0.00",
    val cheque: String = "0.00",
    val total: String = "0.00",
)

data class PendingTotals(val customers: Int = 0, val amount: String = "0.00")

/** Start Day: the vehicle's odometer and where the phone was. */
data class StartTripRequest(
    val version: Int,
    val openingKm: Double? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracyMeters: Double? = null,
)

/** The driver's day (D1): today's trip, its vehicle, the last odometer reading, this week's earnings, vehicle stock. */
data class DriverDayResponse(
    val today: String,
    val driver: DriverRefResponse? = null,
    val trip: TripResponse? = null,
    val vehicle: VehicleRefResponse? = null,
    val routeName: String? = null,
    val lastOdometerKm: String? = null,
    val weekFrom: String = "",
    val earnedThisWeek: String? = null,
    val vehicleStock: TripVehicleStockResponse? = null,
    /** The business's workers: a farm stop's packer and loader are chosen from them (D2). */
    val crew: List<CrewOptionResponse> = emptyList(),
    /** The business's crate types: crates left and taken back at a delivery (D3). */
    val crateTypes: List<CrateTypeResponse> = emptyList(),
)

data class CrateTypeResponse(val id: String, val code: String, val name: String)

/** A completed delivery, as the server keeps it (D3). */
data class DeliveryOutcomeResponse(
    val recipientName: String = "",
    /** scanned | not_scanned | null */
    val qrStatus: String? = null,
    val qrNote: String? = null,
    val allUnloaded: Boolean? = null,
    val shortfalls: List<DeliveryShortfallResponse> = emptyList(),
    val crates: DeliveryCratesCount = DeliveryCratesCount(),
    /** On the phone only, until the server answers: what left the vehicle, by product (for vehicle stock). */
    val delivered: List<DeliveredQuantity> = emptyList(),
)

data class DeliveryShortfallResponse(
    val orderLineId: String,
    val productName: String,
    val uom: String,
    val ordered: String,
    val delivered: String,
    val reason: String,
    val note: String? = null,
)

data class DeliveryCratesCount(val dropped: Int = 0, val collected: Int = 0)

data class DeliveredQuantity(val productId: String, val quantity: String)

data class DriverRefResponse(val employeeId: String, val name: String)
data class VehicleRefResponse(val id: String, val registrationNumber: String)

data class TripVehicleStockResponse(
    val tripId: String,
    val vehicleId: String,
    val registrationNumber: String,
    val rows: List<VehicleStockRowResponse> = emptyList(),
    val totalsKg: VehicleStockTotalsResponse? = null,
)

data class VehicleStockRowResponse(
    val productId: String,
    val product: String,
    val uom: String,
    val onVehicle: String,
    val reserved: String,
    val free: String,
    val toDeliver: String,
    val short: String,
)

data class VehicleStockTotalsResponse(val onVehicle: String, val toDeliver: String, val short: String)

data class TripStopResponse(
    val id: String,
    val tripId: String,
    val sequenceNumber: Int,
    val stopType: String,
    val pickupId: String?,
    val orderId: String?,
    val status: String,
    val arrivedAt: String?,
    val completedAt: String?,
    val notes: String?,
    // Who the stop is for and what it carries, sent with the stops so the
    // route needs one request (Performance Audit PA-02).
    val party: StopPartyResponse? = null,
    val items: List<StopItemResponse> = emptyList(),
    /** A completed farm stop: what was accepted and rejected, and the crew. */
    val farm: FarmStopOutcomeResponse? = null,
    /** A completed delivery: its QR, what was delivered short and why, its crates. */
    val delivery: DeliveryOutcomeResponse? = null,
    // What to collect at a delivery: the order's value from a cash customer, or nothing on credit.
    val collect: StopCollectResponse? = null,
)

data class StopCollectResponse(val terms: String, val amount: String)

/**
 * What this driver may do on the trip right now (delegation level 1–4; 0 =
 * waiting for the owner's approval). The server checks every action against
 * it; the app only uses it to show and grey out.
 */
data class AuthorityResponse(val level: Int, val source: String?, val can: Map<String, Boolean> = emptyMap())

/** Something the owner must hear about at once. */
data class ReportProblemRequest(val kind: String, val note: String)
data class ReportProblemResponse(val reported: Boolean)

data class SkipStopRequest(val reason: String?)

data class StopPartyResponse(
    val kind: String,
    val id: String,
    val name: String,
    val phone: String?,
    /** The village or town; for a delivery, the address it goes to. */
    val place: String? = null,
    val address: String? = null,
    /** Its map pin, when the owner has set one. */
    val latitude: String? = null,
    val longitude: String? = null,
    /** A shop's QR token: the QR at the door must match it (D3). */
    val qrToken: String? = null,
)

data class StopItemResponse(
    val productName: String,
    val quantity: String,
    val uom: String,
    val productId: String = "",
    // Delivery stops: the order line a customer-end measure is for.
    val orderLineId: String? = null,
    // live_bird: the customer's scale may settle it; egg: broken ones come off.
    val kind: String = "standard",
    val packSize: Int? = null,
)

/** What the customer end measured on one line: their scale's net kg (live birds), or eggs broken. */
data class DeliveryLineMeasure(
    val orderLineId: String,
    val customerWeight: Double? = null,
    val brokenQuantity: Double? = null,
    /** What left the vehicle for the line, when it differs from the order (D3). */
    val deliveredQuantity: Double? = null,
    /** Delivered short: why (customer_took_less | damaged | not_enough_on_vehicle | quality_issue | other). */
    val shortReason: String? = null,
    val shortNote: String? = null,
)

/** The farm weighment: net quantity per product, as weighed at the farm. */
data class FarmWeight(val productId: String, val netQuantity: Double)

data class CompletePickupRequest(
    val weights: List<FarmWeight> = emptyList(),
    /** The farmer stop (D2): every product of the purchase order, accepted or rejected. Replaces [weights]. */
    val lines: List<FarmLineRequest>? = null,
    val packerEmployeeId: String? = null,
    val loaderEmployeeId: String? = null,
)

/** One product at a farm stop: accepted (by weight, or sacks × kg a bag) or rejected with a reason. */
data class FarmLineRequest(
    val productId: String,
    /** accepted | rejected */
    val outcome: String,
    val netQuantity: Double? = null,
    /** weight | bags */
    val measuredBy: String? = null,
    val sacks: Int? = null,
    val kgPerBag: Double? = null,
    /** quality_issue | quantity_short | damaged | farmer_not_ready | other */
    val reason: String? = null,
    val note: String? = null,
)

/** A completed farm stop, as the server keeps it. */
data class FarmStopOutcomeResponse(
    val packer: CrewMemberResponse? = null,
    val loader: CrewMemberResponse? = null,
    val lines: List<FarmStopLineResponse> = emptyList(),
    val loadedKg: String = "0.000",
)

data class FarmStopLineResponse(
    val productId: String,
    val productName: String,
    val uom: String,
    val outcome: String,
    val acceptedQuantity: String,
    val rejectedQuantity: String = "0.000",
    val measuredBy: String = "weight",
    val sacks: Int? = null,
    val kgPerBag: String? = null,
    val reason: String? = null,
    val note: String? = null,
)

data class CrewMemberResponse(val employeeId: String, val name: String)

/** A worker the driver can pick as packer or loader. */
data class CrewOptionResponse(val employeeId: String, val name: String, val roleType: String)

data class VersionRequest(val version: Int)

/** Submitting the trip for the owner's reconciliation, with the cash being handed over. */
data class SubmitTripRequest(val version: Int, val cashDeclared: Double?, val note: String?)

/** Cash paid into a bank account on the road. */
data class RecordDepositRequest(val amount: Double, val bankAccount: String, val reference: String, val depositedAt: String?)

data class TripCashDepositResponse(val id: String, val tripId: String, val amount: String, val bankAccount: String, val reference: String)

/** What the driver should hand over: opening cash + cash collected + spot cash − expenses − bank deposits. */
data class HandoverResponse(
    val openingCash: String,
    val cashCollections: String,
    val spotCash: String,
    /** Backhaul rent paid in cash (D5). */
    val backhaulCash: String? = null,
    val expenses: String,
    val deposited: String,
    val expected: String,
    val declared: String?,
    val directPayments: String,
)

data class CompleteDeliveryRequest(
    val recipientName: String,
    val signatureData: String?,
    val lines: List<DeliveryLineMeasure> = emptyList(),
    /** The delivery checklist (D3): the QR scanned, or why not; everything unloaded; crates. */
    val qrToken: String? = null,
    val qrNote: String? = null,
    val allUnloaded: Boolean? = null,
    val crates: List<DeliveryCrates>? = null,
)

/** Crates of one type at a delivery: left with the shop, and taken back. */
data class DeliveryCrates(val crateTypeId: String, val dropped: Int, val collected: Int)

/** [id] is the phone's own, so the bill photo can follow it; a fuel expense carries the pump's details (D6). */
data class RecordExpenseRequest(
    val category: String,
    val amount: Double,
    val notes: String?,
    val id: String? = null,
    val odometerKm: Int? = null,
    val fuelType: String? = null,
    val fullTank: Boolean? = null,
    val litres: Double? = null,
    val ratePerLitre: Double? = null,
)
data class TripExpenseResponse(
    val id: String,
    val tripId: String,
    val category: String,
    val amount: String,
    val notes: String?,
    val recordedBy: String,
    val recordedAt: String,
    val needsApproval: Boolean = false,
    val decision: String? = null,
    val decisionNote: String? = null,
    val fuel: ExpenseFuelResponse? = null,
    val photos: Int = 0,
)
data class ExpenseFuelResponse(
    val odometerKm: Int? = null,
    val fuelType: String? = null,
    val fullTank: Boolean? = null,
    val litres: String? = null,
    val ratePerLitre: String? = null,
)
data class ExpensePhotoResponse(val id: String, val expenseId: String)

data class RecordCollectionRequest(
    val amount: Double,
    val method: String,
    val notes: String?,
    /** UPI or transfer: its reference (UTR). */
    val reference: String? = null,
    /** customer | third_party (D4). */
    val payer: String? = null,
    val payerName: String? = null,
)
data class CustomerCollectionResponse(
    val id: String,
    val tripStopId: String,
    val orderId: String,
    val amount: String,
    val method: String,
    val notes: String?,
    val collectedBy: String,
    val collectedAt: String,
)

data class TripStopPhotoResponse(
    val id: String,
    val tripStopId: String,
    val photoType: String,
    val storageKey: String,
    val contentType: String,
    val sizeBytes: Int,
    val takenAt: String,
)

// ---- Backhaul (D5) ----

data class BackhaulResponse(
    val id: String,
    val tripId: String,
    val pickupPlace: String,
    val dropPlace: String,
    val rent: String,
    val hirerName: String?,
    val notes: String?,
    val offeredBy: String,
    val status: String,
    val skipReason: String?,
    val acceptedAt: String?,
    val pickupReachedAt: String?,
    val loadedAt: String?,
    val dropReachedAt: String?,
    val completedAt: String?,
    val payment: BackhaulPaymentResponse?,
    val photos: BackhaulPhotosResponse,
    val createdAt: String,
)
data class BackhaulPaymentResponse(val method: String, val amount: String, val reference: String?, val note: String?, val paidAt: String)
data class BackhaulPhotosResponse(val load: Int, val drop: Int, val payment: Int)

/** [id]: the phone's own, so a backhaul added offline keeps it. */
data class CreateBackhaulRequest(val id: String, val pickupPlace: String, val dropPlace: String, val rent: Double, val hirerName: String?, val notes: String?)
data class SkipBackhaulRequest(val reason: String)
/** [at]: when it happened on the phone. */
data class BackhaulStepRequest(val step: String, val at: String?)
data class BackhaulPaymentRequest(val method: String, val amount: Double, val reference: String?, val note: String?, val at: String?)
data class BackhaulPhotoResponse(val id: String, val backhaulId: String, val photoType: String)

// ---- The driver's own records (D6) ----

/** My Expenses: the driver's expenses over the days asked for (the last 30), and the vehicle's mileage. */
data class MyExpensesResponse(
    val from: String,
    val to: String,
    val items: List<DriverExpenseResponse> = emptyList(),
    val totals: ExpenseTotalsResponse = ExpenseTotalsResponse(),
    val mileage: VehicleMileageResponse? = null,
)
data class DriverExpenseResponse(
    val id: String,
    val tripId: String,
    val tripNumber: String,
    val category: String,
    val amount: String,
    val notes: String? = null,
    val recordedAt: String,
    val needsApproval: Boolean = false,
    val decision: String? = null,
    val decisionNote: String? = null,
    val fuel: ExpenseFuelResponse? = null,
    val photos: Int = 0,
    /** recorded | pending | approved | rejected */
    val status: String = "recorded",
)
data class ExpenseTotalsResponse(val all: String = "0.00", val fuel: String = "0.00", val other: String = "0.00")
data class VehicleMileageResponse(
    val vehicleId: String,
    val registrationNumber: String,
    val last: FullTankMileageResponse? = null,
    val averageKmPerLitre: String? = null,
)
/** The latest full tank to full tank. */
data class FullTankMileageResponse(val fromKm: Int, val toKm: Int, val km: Int, val litres: String, val kmPerLitre: String? = null)

/** What the driver raised that the owner decides. */
data class DriverApprovalsResponse(
    val since: String,
    val items: List<DriverApprovalResponse> = emptyList(),
    val counts: ApprovalCountsResponse = ApprovalCountsResponse(),
)
data class ApprovalCountsResponse(val pending: Int = 0, val approved: Int = 0, val rejected: Int = 0)
data class DriverApprovalResponse(
    val id: String,
    /** expense | collection | handover */
    val kind: String,
    /** pending | approved | rejected */
    val status: String,
    val amount: String? = null,
    val category: String? = null,
    val customerName: String? = null,
    val detail: String? = null,
    val tripId: String? = null,
    val tripNumber: String? = null,
    val at: String,
    val decidedAt: String? = null,
    val note: String? = null,
    val photos: Int = 0,
)

data class TripHistoryResponse(val from: String, val to: String, val trips: List<DriverTripCardResponse> = emptyList())
data class DriverTripCardResponse(
    val id: String,
    val number: String,
    val day: String? = null,
    val status: String,
    val routeName: String? = null,
    val places: List<String> = emptyList(),
    val procurement: DoneOfResponse = DoneOfResponse(),
    val delivery: DoneOfResponse = DoneOfResponse(),
    val collected: String = "0.00",
    val backhaulReceived: String = "0.00",
    val km: String? = null,
    val startedAt: String? = null,
    val endedAt: String? = null,
    val minutes: Int? = null,
    val fuelLitres: String = "0.000",
)
data class DoneOfResponse(val done: Int = 0, val total: Int = 0)

/** Trip Details: one trip in full. */
data class DriverTripSummaryResponse(
    val card: DriverTripCardResponse,
    val trip: TripResponse,
    val vehicle: SummaryVehicleResponse,
    val stops: List<TripStopResponse> = emptyList(),
    val collections: TripCollectionsResponse? = null,
    val backhauls: List<BackhaulResponse> = emptyList(),
    val expenses: List<TripExpenseResponse> = emptyList(),
    val totals: SummaryTotalsResponse = SummaryTotalsResponse(),
    val closed: TripClosedResponse? = null,
    /** What the driver earned on it (D7): kept at the close, else an estimate. */
    val incentives: TripIncentivesResponse? = null,
)
data class SummaryVehicleResponse(val id: String, val registrationNumber: String, val makeModel: String? = null)
data class SummaryTotalsResponse(val expenses: String = "0.00", val fuel: String = "0.00", val tolls: String = "0.00", val kmPerLitre: String? = null)
data class TripClosedResponse(val at: String, val by: String? = null)

data class MyVehicleResponse(val vehicle: DriverVehicleResponse? = null)
data class DriverVehicleResponse(
    val id: String,
    val registrationNumber: String,
    val makeModel: String? = null,
    val manufactureYear: Int? = null,
    val fuelType: String,
    val ownership: String,
    val status: String,
    val fitForTrips: Boolean = true,
    val issues: List<String> = emptyList(),
    val currentKm: String? = null,
    val averageKmPerLitre: String? = null,
    val lastFullTank: FullTankMileageResponse? = null,
    val maintenance: List<MaintenanceDueResponse> = emptyList(),
    val documents: List<DriverDocumentResponse> = emptyList(),
)
data class MaintenanceDueResponse(
    val kind: String,
    val description: String,
    val lastDate: String,
    val lastKm: Int? = null,
    val nextDueDate: String? = null,
    val nextDueKm: Int? = null,
    val kmLeft: Int? = null,
    val daysLeft: Int? = null,
    /** ok | due_soon | overdue */
    val state: String,
)
data class DriverDocumentResponse(
    val docType: String,
    val validUntil: String? = null,
    val daysLeft: Int? = null,
    /** valid | expiring | expired | no_expiry */
    val state: String,
)

data class DriverProfileResponse(
    val employeeId: String? = null,
    val name: String? = null,
    val phone: String? = null,
    val joinedOn: String? = null,
    val businessName: String = "",
    val vehicle: String? = null,
    val contacts: List<ContactResponse> = emptyList(),
)
data class ContactResponse(val name: String, val phone: String)

// ---- Incentives and earnings (D7) ----

data class TripIncentivesResponse(
    val tripId: String,
    val tripNumber: String,
    /** Kept at the owner's close; false: what the trip would pay now. */
    val final: Boolean = false,
    val lines: List<TripIncentiveLineResponse> = emptyList(),
    val total: String = "0.00",
)
data class TripIncentiveLineResponse(val kind: String, val label: String, val base: String, val percent: String, val amount: String, val detail: String)

/** My Earnings: fixed pay and each incentive over today, this week or this month. */
data class MyEarningsResponse(
    /** today | week | month */
    val period: String,
    val from: String,
    val to: String,
    val fixedPay: String = "0.00",
    val lines: List<EarningsLineResponse> = emptyList(),
    val incentives: String = "0.00",
    /** Of the incentives, what trips not closed yet would pay. */
    val estimated: String = "0.00",
    val total: String = "0.00",
    val rules: List<IncentiveRuleResponse> = emptyList(),
)
data class EarningsLineResponse(val kind: String, val label: String, val amount: String, val estimated: String = "0.00", val trips: Int = 0)
data class IncentiveRuleResponse(val kind: String, val percent: String)

/** A week's pay, approved or paid. */
data class DriverSettlementResponse(
    val id: String,
    val number: Int,
    val periodStart: String,
    val periodEnd: String,
    /** approved | paid */
    val status: String,
    val gross: String,
    val deductions: String,
    val net: String,
    val paidAt: String? = null,
    /** bank | cash_on_hand */
    val paidFrom: String? = null,
    val paymentReference: String? = null,
    val receivedAt: String? = null,
    val lines: List<SettlementLineResponse> = emptyList(),
)
data class SettlementLineResponse(val kind: String, val description: String, val amount: String)

// ---- Chat with the office (D9) ----

/** A message in the driver's conversation with the business; [id] is the phone's own for one written here. */
data class ChatMessageResponse(
    val id: String,
    /** driver | office */
    val side: String,
    val senderName: String,
    val body: String? = null,
    val tripId: String? = null,
    val tripNumber: String? = null,
    /** none | pending (the photo not here yet) | ready */
    val photo: String = "none",
    val writtenAt: String,
    /** When the server had it: what's unread is counted from this. */
    val createdAt: String,
)
data class ChatDriverResponse(val employeeId: String, val name: String)
data class ChatThreadResponse(val driver: ChatDriverResponse, val messages: List<ChatMessageResponse> = emptyList(), val unread: Int = 0, val readAt: String? = null)
/** [writtenAt]: when the driver wrote it — perhaps long before there was signal. */
data class SendChatMessageRequest(val id: String, val body: String?, val tripId: String?, val photo: Boolean, val writtenAt: String)
data class ChatReadRequest(val upTo: String?)
data class ChatReadResponse(val readAt: String)

// ---- The phone's sync, for the office (owner Phase 8) ----

/** What's still on this phone after a sync pass, and what the server refused. */
data class SyncReportRequest(
    val deviceId: String,
    val platform: String,
    val appVersion: String,
    val pendingOperations: Int,
    val failedOperations: Int,
    val pendingPhotos: Int,
    val failedPhotos: Int,
    val oldestPendingAt: String?,
    val failures: List<SyncFailure>,
    /** success | partial */
    val lastResult: String,
    val syncedAt: String,
)
data class SyncFailure(val type: String, val error: String, val at: String)
