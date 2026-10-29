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
)

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

data class RecordExpenseRequest(val category: String, val amount: Double, val notes: String?)
data class TripExpenseResponse(
    val id: String,
    val tripId: String,
    val category: String,
    val amount: String,
    val notes: String?,
    val recordedBy: String,
    val recordedAt: String,
)

data class RecordCollectionRequest(val amount: Double, val method: String, val notes: String?)
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
