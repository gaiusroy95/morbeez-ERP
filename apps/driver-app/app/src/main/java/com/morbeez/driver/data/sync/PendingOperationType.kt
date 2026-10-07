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
}

// What each PendingOperationEntity.payloadJson deserializes into — one
// shape per operation type, carrying whatever that specific backend call
// needs beyond the tripId already on the entity itself.
data class CompletePickupPayload(val stopId: String, val weights: List<com.morbeez.driver.data.remote.dto.FarmWeight> = emptyList())
data class CompleteDeliveryPayload(
    val stopId: String,
    val recipientName: String,
    val signatureData: String?,
    val lines: List<com.morbeez.driver.data.remote.dto.DeliveryLineMeasure> = emptyList(),
)
data class SkipStopPayload(val stopId: String, val reason: String? = null)
data class RecordExpensePayload(val category: String, val amount: Double, val notes: String?)
data class RecordCollectionPayload(val stopId: String, val amount: Double, val method: String, val notes: String?)
data class RecordDepositPayload(val amount: Double, val bankAccount: String, val reference: String, val depositedAt: String)
data class SubmitTripPayload(val cashDeclared: Double?, val note: String?)
data class ReportProblemPayload(val kind: String, val note: String)
