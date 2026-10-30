package com.morbeez.driver.ui.screens.expenses

import com.morbeez.driver.data.local.ExpenseEntity
import com.morbeez.driver.data.remote.dto.DriverExpenseResponse
import com.morbeez.driver.data.remote.dto.MyExpensesResponse
import java.math.BigDecimal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExpenseLogicTest {
    private fun expense(id: String, category: String, amount: String, at: String, over: (ExpenseEntity) -> ExpenseEntity = { it }) =
        over(ExpenseEntity(id = id, tripId = "t1", category = category, amount = amount, recordedAt = at))

    @Test
    fun `amounts, litres and readings as typed`() {
        assertEquals(BigDecimal("92.50"), ExpenseLogic.positive("92.50", 2))
        assertEquals(BigDecimal("65.4"), ExpenseLogic.positive(" 65.4 ", 3))
        assertNull(ExpenseLogic.positive("92.505", 2))
        assertNull(ExpenseLogic.positive("0", 2))
        assertNull(ExpenseLogic.positive("abc", 2))
        assertEquals(48620, ExpenseLogic.km("48620"))
        assertNull(ExpenseLogic.km("48,620"))
    }

    @Test
    fun `the total is litres times the rate, to the paisa — the bill may differ by a rupee`() {
        assertEquals(BigDecimal("6049.50"), ExpenseLogic.fuelTotal(BigDecimal("65.40"), BigDecimal("92.50")))
        assertEquals(BigDecimal("925.00"), ExpenseLogic.fuelTotal(BigDecimal("10"), BigDecimal("92.5")))
        assertNull(ExpenseLogic.fuelTotal(null, BigDecimal("92.5")))
        assertTrue(ExpenseLogic.billMatches(BigDecimal("6050.00"), BigDecimal("65.40"), BigDecimal("92.50")))
        assertFalse(ExpenseLogic.billMatches(BigDecimal("6052.50"), BigDecimal("65.40"), BigDecimal("92.50")))
    }

    @Test
    fun `the odometer at the pump — the server's checks, on the phone`() {
        assertNull(ExpenseLogic.odometerProblem(48620, "48600.0", null, emptyList()))
        assertEquals(OdometerProblem.BELOW_OPENING, ExpenseLogic.odometerProblem(48599, "48600.0", null, emptyList()))
        assertEquals(OdometerProblem.BELOW_EARLIER_FILL, ExpenseLogic.odometerProblem(48610, "48600.0", null, listOf(48650)))
        assertEquals(OdometerProblem.ABOVE_RETURN, ExpenseLogic.odometerProblem(48900, "48600.0", "48812.0", emptyList()))
        assertNull(ExpenseLogic.odometerProblem(10, null, null, emptyList()))
    }

    @Test
    fun `where each stands`() {
        val e = expense("e1", "toll", "120.00", "2026-10-30T05:00:00Z")
        assertEquals(Standing.UNSENT, ExpenseLogic.standingOf(e.copy(pendingSync = true)))
        assertEquals(Standing.RECORDED, ExpenseLogic.standingOf(e))
        assertEquals(Standing.WAITING, ExpenseLogic.standingOf(e.copy(needsApproval = true)))
        assertEquals(Standing.APPROVED, ExpenseLogic.standingOf(e.copy(needsApproval = true, decision = "approved")))
        assertEquals(Standing.REJECTED, ExpenseLogic.standingOf(e.copy(needsApproval = true, decision = "rejected")))
        assertEquals(Standing.WAITING, ExpenseLogic.standingOf("pending"))
        assertEquals(Standing.RECORDED, ExpenseLogic.standingOf("recorded"))
    }

    @Test
    fun `all trips — the server's list, this trip as the phone has it, newest first`() {
        val fill = expense("e1", "fuel", "2775.00", "2026-10-30T06:00:00Z") { it.copy(photos = 1) }
        val unsent = expense("e2", "parking", "50.00", "2026-10-30T07:00:00Z") { it.copy(pendingSync = true) }
        val thisTrip = listOf(unsent, fill).map { ExpenseLogic.rowOf(it, "T-1") }
        val server = MyExpensesResponse(
            from = "2026-10-01",
            to = "2026-10-30",
            items = listOf(
                DriverExpenseResponse(id = "e1", tripId = "t1", tripNumber = "T-1", category = "fuel", amount = "2775.00", recordedAt = "2026-10-30T06:00:00Z", photos = 0),
                DriverExpenseResponse(id = "old", tripId = "t0", tripNumber = "T-0", category = "toll", amount = "120.00", recordedAt = "2026-10-28T06:00:00Z", status = "rejected", decisionNote = "No toll"),
            ),
        )
        val all = ExpenseLogic.allTrips(server, thisTrip)
        assertEquals(listOf("e2", "e1", "old"), all.map { it.id })
        assertEquals(1, all.first { it.id == "e1" }.photos)
        assertEquals(Standing.REJECTED, all.last().standing)
        assertEquals(listOf("e2", "e1"), ExpenseLogic.allTrips(null, thisTrip).map { it.id })
    }

    @Test
    fun `totals — in all, on fuel and the rest`() {
        val rows = listOf(
            expense("a", "fuel", "2775.00", "2026-10-30T06:00:00Z"),
            expense("b", "fuel", "925.00", "2026-10-30T05:00:00Z"),
            expense("c", "repair", "1200.00", "2026-10-30T04:00:00Z"),
            expense("d", "parking", "50.50", "2026-10-30T03:00:00Z"),
        ).map { ExpenseLogic.rowOf(it, null) }
        val t = ExpenseLogic.totalsOf(rows)
        assertEquals(BigDecimal("4950.50"), t.all)
        assertEquals(BigDecimal("3700.00"), t.fuel)
        assertEquals(BigDecimal("1250.50"), t.other)
    }
}
