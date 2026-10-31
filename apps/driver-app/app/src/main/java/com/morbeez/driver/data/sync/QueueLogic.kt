package com.morbeez.driver.data.sync

import com.morbeez.driver.data.local.PendingOperationEntity
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types

/**
 * What the phone knows about an action the office refused (D8, field
 * hardening; Driver App Architecture DRV.8): which stop it was about, the
 * money in it, whether the driver can correct it here or only remove it.
 */
object QueueLogic {
    /** Actions with money in them: removing one needs the driver to say what happened (it's told to the office). */
    val MONEY = setOf(
        PendingOperationType.RECORD_COLLECTION.name,
        PendingOperationType.RECORD_EXPENSE.name,
        PendingOperationType.RECORD_DEPOSIT.name,
        PendingOperationType.PAY_BACKHAUL.name,
        PendingOperationType.SUBMIT_TRIP.name,
        PendingOperationType.RAISE_DISPUTE.name,
    )

    /**
     * Corrected on the phone and sent again in their place: the odometer
     * readings the office checks against the vehicle's. (An amount isn't one —
     * the office takes more than is owed as credit on account, so a refused
     * collection is about the trip, not its amount.)
     */
    val FIXABLE = setOf(
        PendingOperationType.START_TRIP.name,
        PendingOperationType.RETURN_TRIP.name,
    )

    private val STOP_ACTIONS = setOf(
        PendingOperationType.ARRIVE_STOP.name,
        PendingOperationType.COMPLETE_PICKUP_STOP.name,
        PendingOperationType.COMPLETE_DELIVERY_STOP.name,
        PendingOperationType.SKIP_STOP.name,
        PendingOperationType.RECORD_COLLECTION.name,
        PendingOperationType.RAISE_DISPUTE.name,
    )

    /** An action's payload as plain fields; empty when unreadable. */
    fun fields(json: String, moshi: Moshi): Map<String, Any?> {
        val type = Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
        return runCatching { moshi.adapter<Map<String, Any?>>(type).fromJson(json) }.getOrNull() ?: emptyMap()
    }

    /** The stop an action was about; null for one that isn't a stop's. */
    fun stopIdOf(op: PendingOperationEntity, moshi: Moshi): String? =
        if (op.operationType in STOP_ACTIONS) fields(op.payloadJson, moshi)["stopId"] as? String else null

    /** Each stop with an action the office refused, and the office's words — the first refusal for it. */
    fun refusedStops(failed: List<PendingOperationEntity>, moshi: Moshi): Map<String, String> {
        val out = linkedMapOf<String, String>()
        for (op in failed.filter { it.status == "failed_needs_review" }.sortedBy { it.sequence }) {
            val stopId = stopIdOf(op, moshi) ?: continue
            out.putIfAbsent(stopId, op.lastError ?: "")
        }
        return out
    }

    /** The money in an action: a collection, expense, deposit, dispute or payment's amount, a handover's cash. */
    fun amountOf(op: PendingOperationEntity, moshi: Moshi): Double? {
        val f = fields(op.payloadJson, moshi)
        return (f["amount"] ?: f["cashDeclared"]) as? Double
    }

    /** A reading in an action: Start Day's opening KM, Return's closing KM. */
    fun kmOf(op: PendingOperationEntity, moshi: Moshi): Double? {
        val f = fields(op.payloadJson, moshi)
        return (f["openingKm"] ?: f["closingKm"]) as? Double
    }

    /** What else to say about it: a payment's method, an expense's category. */
    fun detailOf(op: PendingOperationEntity, moshi: Moshi): String? {
        val f = fields(op.payloadJson, moshi)
        return (f["method"] ?: f["category"]) as? String
    }
}
