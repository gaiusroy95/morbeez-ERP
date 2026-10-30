package com.morbeez.driver.ui.screens.backhaul

import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.ui.screens.collect.AmountProblem
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.home.NextAction
import java.math.BigDecimal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackhaulLogicTest {
    private val at = "2026-10-29T11:20:00Z"

    private fun backhaul(id: String = "b1", status: String = "offered", rent: String = "3500.00") = BackhaulEntity(
        id = id, tripId = "t1", pickupPlace = "Mysuru Market", dropPlace = "Gundlupet Base", rent = rent,
        offeredBy = "owner", status = status, createdAt = at,
    )

    private fun running() = backhaul(status = "accepted").copy(acceptedAt = at)
    private fun done() = running().copy(pickupReachedAt = at, loadedAt = at, dropReachedAt = at, completedAt = at, status = "completed", loadPhotos = 1, dropPhotos = 1)

    @Test
    fun `where a backhaul is`() {
        assertEquals(BackhaulStage.OFFERED, BackhaulLogic.stageOf(backhaul()))
        assertEquals(BackhaulStage.RUNNING, BackhaulLogic.stageOf(running()))
        assertEquals(BackhaulStage.TO_PAY, BackhaulLogic.stageOf(done()))
        assertEquals(BackhaulStage.PAID, BackhaulLogic.stageOf(done().copy(paidAt = at, paymentMethod = "cash", amountReceived = "3500.00")))
        assertEquals(BackhaulStage.SKIPPED, BackhaulLogic.stageOf(backhaul(status = "skipped")))
    }

    @Test
    fun `the steps go pickup reached, loaded, drop reached, completed`() {
        assertNull(BackhaulLogic.nextStepOf(backhaul()))
        assertEquals("pickup_reached", BackhaulLogic.nextStepOf(running()))
        assertEquals("loaded", BackhaulLogic.nextStepOf(running().copy(pickupReachedAt = at)))
        assertEquals("completed", BackhaulLogic.nextStepOf(running().copy(pickupReachedAt = at, loadedAt = at, dropReachedAt = at)))
        assertNull(BackhaulLogic.nextStepOf(done()))
    }

    @Test
    fun `it runs after the last stop, the load and the drop photographed`() {
        assertEquals(StepBlock.STOPS_LEFT, BackhaulLogic.blockOf(running(), stopsLeft = 1))
        assertNull(BackhaulLogic.blockOf(running(), stopsLeft = 0))
        val reached = running().copy(pickupReachedAt = at)
        assertEquals(StepBlock.LOAD_PHOTO, BackhaulLogic.blockOf(reached, 0))
        assertNull(BackhaulLogic.blockOf(reached.copy(loadPhotos = 1), 0))
        val dropped = reached.copy(loadedAt = at, dropReachedAt = at, loadPhotos = 1)
        assertEquals(StepBlock.DROP_PHOTO, BackhaulLogic.blockOf(dropped, 0))
    }

    @Test
    fun `the one to work on is the one under way, then one to be paid, then an offer`() {
        val offer = backhaul("b1")
        val toPay = done().copy(id = "b2")
        val onWay = running().copy(id = "b3")
        assertEquals("b3", BackhaulLogic.currentOf(listOf(offer, toPay, onWay))?.id)
        assertEquals("b2", BackhaulLogic.currentOf(listOf(offer, toPay))?.id)
        assertEquals("b1", BackhaulLogic.currentOf(listOf(backhaul("b0", "skipped"), offer))?.id)
        assertNull(BackhaulLogic.currentOf(listOf(backhaul("b0", "cancelled"))))
    }

    @Test
    fun `an offer or one under way holds the Return, an unpaid one the handover`() {
        assertTrue(BackhaulLogic.holdsReturn(listOf(backhaul())))
        assertTrue(BackhaulLogic.holdsReturn(listOf(running())))
        assertFalse(BackhaulLogic.holdsReturn(listOf(done(), backhaul(status = "skipped"))))
        assertTrue(BackhaulLogic.holdsHandover(listOf(done())))
        assertFalse(BackhaulLogic.holdsHandover(listOf(done().copy(paidAt = at, paymentMethod = "upi", amountReceived = "3500.00"))))
    }

    @Test
    fun `rent paid in cash counts in the handover, and never more than the rent is recorded`() {
        val cash = done().copy(paidAt = at, paymentMethod = "cash", amountReceived = "3500.00")
        val upi = done().copy(id = "b2", paidAt = at, paymentMethod = "upi", amountReceived = "800.00")
        assertEquals(BigDecimal("3500.00"), BackhaulLogic.cashOf(listOf(cash, upi)))
        assertEquals(AmountProblem.MORE_THAN_OWED, BackhaulLogic.amountProblem("4000", "3500.00"))
        assertNull(BackhaulLogic.amountProblem("3000", "3500.00"))
        assertEquals(AddProblem.RENT, BackhaulLogic.addProblem("Gundlupet", "Begur", ""))
        assertEquals(AddProblem.DROP, BackhaulLogic.addProblem("Gundlupet", " ", "800"))
        assertNull(BackhaulLogic.addProblem("Gundlupet", "Begur", "800"))
    }

    @Test
    fun `after the last stop the Dashboard goes to the backhaul, then Return`() {
        val trip = TripEntity(
            id = "t1", vehicleId = "v1", vehicleRegistrationNumber = "KA01D10001", driverEmployeeId = "e1", status = "in_progress",
            plannedDate = "2026-10-29", advanceAmount = "0.00", version = 1, reviewNote = null, openingKm = "48650.0",
        )
        val stops = listOf(
            TripStopEntity(id = "s1", tripId = "t1", sequenceNumber = 1, stopType = "delivery", status = "completed", pickupId = null, orderId = null, counterpartyName = "Hotel Sagar", summary = "", notes = null),
        )
        assertEquals(NextAction.Backhaul(backhaul()), DayLogic.nextActionOf(trip, stops, listOf(backhaul())))
        assertEquals(NextAction.Return, DayLogic.nextActionOf(trip, stops, listOf(backhaul(status = "skipped"))))
        val pending = stops.map { it.copy(status = "pending") }
        assertEquals(NextAction.GoTo(pending[0]), DayLogic.nextActionOf(trip, pending, listOf(backhaul())))
    }
}
