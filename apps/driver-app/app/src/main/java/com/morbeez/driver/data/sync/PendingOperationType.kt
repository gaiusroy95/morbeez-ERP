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
    RETURN_TRIP,
    RAISE_DISPUTE,
    CREATE_BACKHAUL,
    ACCEPT_BACKHAUL,
    SKIP_BACKHAUL,
    BACKHAUL_STEP,
    PAY_BACKHAUL,
    ACKNOWLEDGE_PAY,
    SEND_MESSAGE,
    READ_CHAT,
    CREATE_REQUEST,
}

/** The conversation with the office (D9). */
val CHAT_OPERATIONS = setOf(PendingOperationType.SEND_MESSAGE.name, PendingOperationType.READ_CHAT.name)

/**
 * Sent on their own lane, never behind a trip action the server refused: the
 * conversation with the office (D9) and what the driver asks it for (D10) —
 * an advance mustn't wait on a stuck delivery.
 */
val OFFICE_OPERATIONS = CHAT_OPERATIONS + PendingOperationType.CREATE_REQUEST.name

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
/** [expenseId]: the phone's own (D6), so its bill follows it; a fuel expense's pump details. Older queued payloads have neither. */
data class RecordExpensePayload(
    val category: String,
    val amount: Double,
    val notes: String?,
    val expenseId: String? = null,
    val odometerKm: Int? = null,
    val fuelType: String? = null,
    val fullTank: Boolean? = null,
    val litres: Double? = null,
    val ratePerLitre: Double? = null,
    /** cash | fastag (a toll or parking only); older queued payloads have none — cash. */
    val paidBy: String? = null,
)
data class RecordCollectionPayload(
    val stopId: String,
    val amount: Double,
    val method: String,
    val notes: String?,
    /** UPI or transfer: its reference (D4). */
    val reference: String? = null,
    /** customer | third_party, and who (D4). */
    val payer: String? = null,
    val payerName: String? = null,
)
data class ReturnTripPayload(val closingKm: Double)
data class RaiseDisputePayload(val stopId: String, val amount: Double, val reason: String)
data class RecordDepositPayload(val amount: Double, val bankAccount: String, val reference: String, val depositedAt: String)
data class SubmitTripPayload(val cashDeclared: Double?, val note: String?)
data class ReportProblemPayload(val kind: String, val note: String)
data class StartTripPayload(val openingKm: Double, val latitude: Double?, val longitude: Double?, val accuracyMeters: Double?)

/** Backhaul (D5): [backhaulId] is the phone's own for one the driver added. */
data class CreateBackhaulPayload(val backhaulId: String, val pickupPlace: String, val dropPlace: String, val rent: Double, val hirerName: String?, val notes: String?)
data class BackhaulPayload(val backhaulId: String)
data class SkipBackhaulPayload(val backhaulId: String, val reason: String)
/** pickup_reached | loaded | drop_reached | completed, and when on the phone. */
data class BackhaulStepPayload(val backhaulId: String, val step: String, val at: String)
data class PayBackhaulPayload(val backhaulId: String, val method: String, val amount: Double, val reference: String?, val note: String?, val at: String)

/** "I received it" (D7): the settlement the driver says reached them. */
data class AcknowledgePayPayload(val settlementId: String)

/** A message to the office (D9): [messageId] is the phone's own, so sent again it's the same message, and its photo follows it. */
data class SendMessagePayload(val messageId: String, val body: String?, val tripId: String?, val photo: Boolean, val writtenAt: String)
/** Read up to [upTo], by when the server had each message. */
data class ReadChatPayload(val upTo: String)

/** What the driver asks the office for (D10): [requestId] is the phone's own, so it's the same request however often it's sent. */
data class CreateRequestPayload(
    val requestId: String,
    /** advance | new_customer | credit_limit */
    val kind: String,
    val amount: Double? = null,
    val customerId: String? = null,
    /** A credit limit: whose, as the driver picked it. */
    val customerName: String? = null,
    val customer: com.morbeez.driver.data.remote.dto.NewCustomerDetails? = null,
    val reason: String,
    val tripId: String? = null,
)
