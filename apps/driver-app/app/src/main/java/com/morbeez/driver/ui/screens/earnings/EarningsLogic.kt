package com.morbeez.driver.ui.screens.earnings

import com.morbeez.driver.data.remote.dto.DriverSettlementResponse
import com.morbeez.driver.data.remote.dto.IncentiveRuleResponse
import com.morbeez.driver.data.remote.dto.MyEarningsResponse
import java.math.BigDecimal
import java.math.RoundingMode

/** Where a week's pay stands, as the driver sees it. */
enum class PayStanding {
    /** Approved by the owner, not paid yet. */
    TO_BE_PAID,
    PAID,

    /** The driver said they got it — on this phone, not sent yet. */
    SENDING,
    RECEIVED,
}

/**
 * My Earnings and the week's pay (driver app V1, D7; client spec §24–§25):
 * the incentive a backhaul offer would pay, and where each settlement
 * stands. The earnings themselves are the server's — calculated from the
 * trip's data, never entered here.
 */
object EarningsLogic {
    /** The ten incentives, in the order the owner's rules list them. */
    val KINDS = listOf("collection", "backhaul", "mileage", "crates", "quality", "new_customer", "performance", "night_duty", "data_quality", "completion")

    /** "₹350 if completed": the owner's backhaul percentage of the rent; null when the owner pays none. */
    fun backhaulIncentive(rent: String, rules: List<IncentiveRuleResponse>?): BigDecimal? {
        val percent = rules?.firstOrNull { it.kind == "backhaul" }?.percent?.toBigDecimalOrNull() ?: return null
        val amount = rent.toBigDecimalOrNull() ?: return null
        return amount.multiply(percent).divide(BigDecimal(100), 2, RoundingMode.HALF_UP).takeIf { it.signum() > 0 }
    }

    fun standingOf(s: DriverSettlementResponse, sending: Set<String>): PayStanding = when {
        s.receivedAt != null -> PayStanding.RECEIVED
        s.id in sending -> PayStanding.SENDING
        s.status == "paid" -> PayStanding.PAID
        else -> PayStanding.TO_BE_PAID
    }

    /** The lines in the rules' order — the server's, with any incentive it didn't list left out. */
    fun linesOf(e: MyEarningsResponse?) = e?.lines.orEmpty().sortedBy { KINDS.indexOf(it.kind).let { i -> if (i < 0) Int.MAX_VALUE else i } }

    /** Part of the total is an estimate (a trip not closed yet). */
    fun hasEstimate(e: MyEarningsResponse?): Boolean = (e?.estimated?.toBigDecimalOrNull() ?: BigDecimal.ZERO).signum() > 0
}
