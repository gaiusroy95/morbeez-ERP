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
)

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

data class StopPartyResponse(val kind: String, val id: String, val name: String, val phone: String?)

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
data class DeliveryLineMeasure(val orderLineId: String, val customerWeight: Double? = null, val brokenQuantity: Double? = null)

/** The farm weighment: net quantity per product, as weighed at the farm. */
data class FarmWeight(val productId: String, val netQuantity: Double)

data class CompletePickupRequest(val weights: List<FarmWeight> = emptyList())

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
)

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
