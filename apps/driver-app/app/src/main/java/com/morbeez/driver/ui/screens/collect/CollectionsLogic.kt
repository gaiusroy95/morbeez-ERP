package com.morbeez.driver.ui.screens.collect

import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.TripCollectionsResponse
import com.morbeez.driver.data.sync.RaiseDisputePayload
import com.morbeez.driver.data.sync.RecordCollectionPayload
import java.math.BigDecimal
import java.math.RoundingMode

/** The ways a customer pays at the door, as the server names them. */
val PAYMENT_METHODS = listOf("cash", "upi", "bank_transfer", "cheque")

/** A customer delivered on this trip, and what they owe — as the phone reckons it. */
data class CollectRow(
    val stopId: String,
    val customerId: String?,
    val name: String,
    val phone: String?,
    val place: String?,
    val cash: Boolean,
    /** Their whole outstanding; null until the office has counted a delivery made on this phone. */
    val outstanding: BigDecimal?,
    /** Disputed, with the owner. */
    val disputed: BigDecimal,
    val collectedOnTrip: BigDecimal,
) {
    /** Still to collect: outstanding less disputed. */
    val remaining: BigDecimal? get() = outstanding?.let { (it - disputed).max(BigDecimal.ZERO) }
    /** Nothing left to collect. */
    val settled: Boolean get() = remaining?.signum() == 0
}

/** Collected on the trip, by how it was paid. */
data class CollectedByMethod(val cash: BigDecimal, val upi: BigDecimal, val bankTransfer: BigDecimal, val cheque: BigDecimal) {
    val total: BigDecimal get() = cash + upi + bankTransfer + cheque
}

enum class AmountProblem { BLANK, BAD_NUMBER, MORE_THAN_OWED }

/**
 * Collections (driver app V1, D4; client spec §18–§21), kept apart from
 * Android so they're unit-tested: only the customers delivered on this
 * trip, with their whole outstanding (the office's last count, less what
 * this phone has collected or seen disputed since); the totals by method.
 */
object CollectionsLogic {
    private fun money(s: String?) = s?.toBigDecimalOrNull()?.setScale(2, RoundingMode.HALF_UP) ?: BigDecimal.ZERO.setScale(2)

    fun rowsOf(
        board: TripCollectionsResponse?,
        stops: List<TripStopEntity>,
        queued: List<RecordCollectionPayload>,
        disputes: List<RaiseDisputePayload>,
    ): List<CollectRow> {
        val paid = queued.groupBy { it.stopId }.mapValues { (_, list) -> list.fold(BigDecimal.ZERO) { s, c -> s + BigDecimal.valueOf(c.amount) } }
        val argued = disputes.groupBy { it.stopId }.mapValues { (_, list) -> list.fold(BigDecimal.ZERO) { s, d -> s + BigDecimal.valueOf(d.amount) } }
        val counted = board?.customers.orEmpty().map { c ->
            val more = paid[c.stopId] ?: BigDecimal.ZERO
            CollectRow(
                stopId = c.stopId,
                customerId = c.customerId,
                name = c.name,
                phone = c.phone,
                place = c.place,
                cash = c.terms == "cash",
                outstanding = (money(c.outstanding) - more).max(BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP),
                disputed = (money(c.disputed) + (argued[c.stopId] ?: BigDecimal.ZERO)).setScale(2, RoundingMode.HALF_UP),
                collectedOnTrip = (money(c.collectedOnTrip) + more).setScale(2, RoundingMode.HALF_UP),
            )
        }
        // Delivered on this phone, not counted by the office yet: listed, what they owe follows the next sync.
        val known = counted.map { it.stopId }.toSet()
        val fresh = stops
            .filter { it.stopType == "delivery" && it.status == "completed" && it.id !in known && (board == null || it.pendingSync) }
            .map { s ->
                CollectRow(
                    stopId = s.id,
                    customerId = null,
                    name = s.counterpartyName,
                    phone = s.partyPhone,
                    place = s.partyPlace,
                    cash = s.collectTerms == "cash",
                    outstanding = null,
                    disputed = argued[s.id] ?: BigDecimal.ZERO,
                    collectedOnTrip = paid[s.id] ?: BigDecimal.ZERO,
                )
            }
        return counted + fresh
    }

    fun collectedOf(board: TripCollectionsResponse?, queued: List<RecordCollectionPayload>): CollectedByMethod {
        fun queuedBy(method: String) = queued.filter { it.method == method }.fold(BigDecimal.ZERO) { s, c -> s + BigDecimal.valueOf(c.amount) }
        val c = board?.collected
        return CollectedByMethod(
            cash = (money(c?.cash) + queuedBy("cash")).setScale(2, RoundingMode.HALF_UP),
            upi = (money(c?.upi) + queuedBy("upi")).setScale(2, RoundingMode.HALF_UP),
            bankTransfer = (money(c?.bankTransfer) + queuedBy("bank_transfer")).setScale(2, RoundingMode.HALF_UP),
            cheque = (money(c?.cheque) + queuedBy("cheque")).setScale(2, RoundingMode.HALF_UP),
        )
    }

    /** Customers still owing — and those whose balance isn't counted yet — and what's known to be pending. */
    fun pendingOf(rows: List<CollectRow>): Pair<Int, BigDecimal> =
        rows.count { !it.settled } to rows.fold(BigDecimal.ZERO) { s, r -> s + (r.remaining ?: BigDecimal.ZERO) }.setScale(2, RoundingMode.HALF_UP)

    /** What's wrong with an amount typed, if anything: rupees and paise, more than 0, never more than they owe. */
    fun amountProblem(text: String, remaining: BigDecimal?): AmountProblem? {
        if (text.isBlank()) return AmountProblem.BLANK
        val n = text.trim().toBigDecimalOrNull() ?: return AmountProblem.BAD_NUMBER
        if (n.signum() <= 0 || n.stripTrailingZeros().scale() > 2) return AmountProblem.BAD_NUMBER
        if (remaining != null && n > remaining) return AmountProblem.MORE_THAN_OWED
        return null
    }

    /** Trip KM: closing − opening; null until both are known. */
    fun tripKm(openingKm: String?, closingKm: String?): BigDecimal? {
        val open = openingKm?.toBigDecimalOrNull() ?: return null
        val close = closingKm?.toBigDecimalOrNull() ?: return null
        return (close - open).setScale(1, RoundingMode.HALF_UP)
    }
}
