package com.morbeez.driver.data.sync

/**
 * One entry per action a driver can take offline (Driver App Architecture,
 * DRV.5). Each maps to exactly one ApiService call — the sync engine never
 * invents a request shape the backend wasn't already going to accept from
 * the web app.
 */
enum class PendingOperationType {
    COMPLETE_PICKUP_STOP,
    COMPLETE_DELIVERY_STOP,
    SKIP_STOP,
    RECORD_EXPENSE,
    RECORD_COLLECTION,
    RECORD_DEPOSIT,
    SUBMIT_TRIP,
    REPORT_PROBLEM,
    START_TRIP,
    ARRIVE_STOP,
    START_DELIVERIES,
}

// What each PendingOperationEntity.payloadJson deserializes into — one
// shape per operation type, carrying whatever that specific backend call
// needs beyond the tripId already on the entity itself.
data class CompletePickupPayload(
    val stopId: String,
    val weights: List<com.morbeez.driver.data.remote.dto.FarmWeight> = emptyList(),
    /** The farmer stop (D2): every product accepted or rejected, and the crew. */
    val lines: List<com.morbeez.driver.data.remote.dto.FarmLineRequest>? = null,
    val packerEmployeeId: String? = null,
    val loaderEmployeeId: String? = null,
)
data class ArriveStopPayload(val stopId: String)
data class CompleteDeliveryPayload(
    val stopId: String,
    val recipientName: String,
    val signatureData: String?,
    val lines: List<com.morbeez.driver.data.remote.dto.DeliveryLineMeasure> = emptyList(),
    /** The delivery checklist (D3). */
    val qrToken: String? = null,
    val qrNote: String? = null,
    val allUnloaded: Boolean? = null,
    val crates: List<com.morbeez.driver.data.remote.dto.DeliveryCrates>? = null,
)
data class StartDeliveriesPayload(val at: String)
data class SkipStopPayload(val stopId: String, val reason: String? = null)
data class RecordExpensePayload(val category: String, val amount: Double, val notes: String?)
data class RecordCollectionPayload(val stopId: String, val amount: Double, val method: String, val notes: String?)
data class RecordDepositPayload(val amount: Double, val bankAccount: String, val reference: String, val depositedAt: String)
data class SubmitTripPayload(val cashDeclared: Double?, val note: String?)
data class ReportProblemPayload(val kind: String, val note: String)
data class StartTripPayload(val openingKm: Double, val latitude: Double?, val longitude: Double?, val accuracyMeters: Double?)
