package com.morbeez.driver.ui.screens.collect

import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CollectedTotals
import com.morbeez.driver.data.remote.dto.CollectionCustomerResponse
import com.morbeez.driver.data.remote.dto.TripCollectionsResponse
import com.morbeez.driver.data.sync.RaiseDisputePayload
import com.morbeez.driver.data.sync.RecordCollectionPayload
import java.math.BigDecimal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionsLogicTest {
    private val board = TripCollectionsResponse(
        tripId = "t1",
        customers = listOf(
            CollectionCustomerResponse("c-1", "Hotel Sagar", stopId = "s-1", terms = "cash", outstanding = "48500.00", disputed = "0.00", collectedOnTrip = "0.00"),
            CollectionCustomerResponse("c-2", "Green Leaf", stopId = "s-2", terms = "credit", outstanding = "0.00"),
        ),
        collected = CollectedTotals(cash = "1000.00", upi = "500.00", total = "1500.00"),
    )

    private fun stop(id: String, status: String = "completed", pending: Boolean = false) = TripStopEntity(
        id = id, tripId = "t1", sequenceNumber = 1, stopType = "delivery", status = status, pickupId = null, orderId = "o-$id",
        counterpartyName = "Shop $id", summary = "", notes = null, pendingSync = pending, collectTerms = "cash",
    )

    @Test
    fun `the office's list, less what this phone collected and saw disputed since`() {
        val rows = CollectionsLogic.rowsOf(
            board,
            listOf(stop("s-1"), stop("s-2")),
            queued = listOf(RecordCollectionPayload("s-1", 8500.0, "cash", null)),
            disputes = listOf(RaiseDisputePayload("s-1", 200.0, "soft")),
        )
        val sagar = rows.first { it.stopId == "s-1" }
        assertEquals(BigDecimal("40000.00"), sagar.outstanding)
        assertEquals(BigDecimal("200.00"), sagar.disputed)
        assertEquals(BigDecimal("39800.00"), sagar.remaining)
        assertEquals(BigDecimal("8500.00"), sagar.collectedOnTrip)
        assertFalse(sagar.settled)
        assertTrue(rows.first { it.stopId == "s-2" }.settled)
    }

    @Test
    fun `a delivery made on this phone is listed before the office counts it, balance after sync`() {
        val rows = CollectionsLogic.rowsOf(board, listOf(stop("s-1"), stop("s-2"), stop("s-3", pending = true), stop("s-4", status = "pending")), emptyList(), emptyList())
        val fresh = rows.first { it.stopId == "s-3" }
        assertNull(fresh.outstanding)
        assertFalse(fresh.settled)
        assertEquals(3, rows.size)
    }

    @Test
    fun `pending counts who still owes, and what's known`() {
        val rows = CollectionsLogic.rowsOf(board, listOf(stop("s-1"), stop("s-2")), emptyList(), emptyList())
        assertEquals(1 to BigDecimal("48500.00"), CollectionsLogic.pendingOf(rows))
    }

    @Test
    fun `collected by method, with what's queued on this phone`() {
        val collected = CollectionsLogic.collectedOf(board, listOf(RecordCollectionPayload("s-1", 250.0, "cash", null), RecordCollectionPayload("s-1", 100.0, "cheque", null)))
        assertEquals(BigDecimal("1250.00"), collected.cash)
        assertEquals(BigDecimal("500.00"), collected.upi)
        assertEquals(BigDecimal("100.00"), collected.cheque)
        assertEquals(BigDecimal("1850.00"), collected.total)
    }

    @Test
    fun `an amount is rupees and paise, more than nothing, never more than they owe`() {
        assertEquals(AmountProblem.BLANK, CollectionsLogic.amountProblem(" ", BigDecimal("100")))
        assertEquals(AmountProblem.BAD_NUMBER, CollectionsLogic.amountProblem("0", BigDecimal("100")))
        assertEquals(AmountProblem.BAD_NUMBER, CollectionsLogic.amountProblem("10.555", BigDecimal("100")))
        assertEquals(AmountProblem.MORE_THAN_OWED, CollectionsLogic.amountProblem("100.01", BigDecimal("100")))
        assertNull(CollectionsLogic.amountProblem("100", BigDecimal("100")))
        assertNull(CollectionsLogic.amountProblem("5000", null))
    }

    @Test
    fun `trip KM is closing less opening`() {
        assertEquals(BigDecimal("192.0"), CollectionsLogic.tripKm("48650.0", "48842"))
        assertNull(CollectionsLogic.tripKm("48650.0", null))
    }
}
