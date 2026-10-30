package com.morbeez.driver.ui.screens.earnings

import com.morbeez.driver.data.remote.dto.DriverSettlementResponse
import com.morbeez.driver.data.remote.dto.EarningsLineResponse
import com.morbeez.driver.data.remote.dto.IncentiveRuleResponse
import com.morbeez.driver.data.remote.dto.MyEarningsResponse
import java.math.BigDecimal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EarningsLogicTest {
    @Test
    fun `the backhaul incentive an offer would pay — the owner's percentage of the rent`() {
        val rules = listOf(IncentiveRuleResponse("collection", "0.200"), IncentiveRuleResponse("backhaul", "10.000"))
        assertEquals(BigDecimal("350.00"), EarningsLogic.backhaulIncentive("3500.00", rules))
        assertEquals(BigDecimal("33.33"), EarningsLogic.backhaulIncentive("333.33", rules))
        assertNull(EarningsLogic.backhaulIncentive("3500.00", rules.filter { it.kind != "backhaul" }))
        assertNull(EarningsLogic.backhaulIncentive("3500.00", null))
        assertNull(EarningsLogic.backhaulIncentive("3500.00", listOf(IncentiveRuleResponse("backhaul", "0.000"))))
    }

    @Test
    fun `where a week's pay stands`() {
        val s = DriverSettlementResponse(id = "s1", number = 12, periodStart = "2026-10-26", periodEnd = "2026-11-01", status = "approved", gross = "2723.60", deductions = "0.00", net = "2723.60")
        assertEquals(PayStanding.TO_BE_PAID, EarningsLogic.standingOf(s, emptySet()))
        assertEquals(PayStanding.PAID, EarningsLogic.standingOf(s.copy(status = "paid", paidAt = "2026-11-02T10:00:00Z"), emptySet()))
        assertEquals(PayStanding.SENDING, EarningsLogic.standingOf(s.copy(status = "paid"), setOf("s1")))
        assertEquals(PayStanding.RECEIVED, EarningsLogic.standingOf(s.copy(status = "paid", receivedAt = "2026-11-02T11:00:00Z"), setOf("s1")))
    }

    @Test
    fun `the lines in the rules' order, and whether any is an estimate`() {
        val e = MyEarningsResponse(
            period = "today",
            from = "2026-10-30",
            to = "2026-10-30",
            lines = listOf(EarningsLineResponse("completion", "Trip completion", "240.00"), EarningsLineResponse("collection", "Collection incentive", "304.00", estimated = "304.00")),
        )
        assertEquals(listOf("collection", "completion"), EarningsLogic.linesOf(e).map { it.kind })
        assertFalse(EarningsLogic.hasEstimate(e))
        assertTrue(EarningsLogic.hasEstimate(e.copy(estimated = "304.00")))
        assertEquals(emptyList<EarningsLineResponse>(), EarningsLogic.linesOf(null))
    }
}
