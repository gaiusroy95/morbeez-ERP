package com.morbeez.driver.ui.screens.home

import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DayLogicTest {
    private fun trip(status: String, note: String? = null) = TripEntity(
        id = "t1",
        vehicleId = "v1",
        vehicleRegistrationNumber = "KA01D10001",
        driverEmployeeId = "e1",
        status = status,
        plannedDate = "2026-10-28",
        advanceAmount = "0.00",
        version = 1,
        reviewNote = note,
    )

    private fun stop(seq: Int, type: String, status: String = "pending", lat: Double? = null, lng: Double? = null) = TripStopEntity(
        id = "s$seq",
        tripId = "t1",
        sequenceNumber = seq,
        stopType = type,
        status = status,
        pickupId = null,
        orderId = null,
        counterpartyName = "Party $seq",
        summary = "",
        notes = null,
        partyLatitude = lat,
        partyLongitude = lng,
    )

    @Test
    fun `no trip planned asks nothing but says so`() {
        assertEquals(NextAction.NoTrip, DayLogic.nextActionOf(null, emptyList()))
        assertNull(DayLogic.stepOf(null, emptyList()))
    }

    @Test
    fun `a planned trip starts the day`() {
        val stops = listOf(stop(1, "pickup"), stop(2, "delivery"))
        assertEquals(NextAction.StartDay, DayLogic.nextActionOf(trip("planned"), stops))
        assertEquals(DayStep.START, DayLogic.stepOf(trip("planned"), stops))
    }

    @Test
    fun `on the road, the next stop is the first not done in visiting order`() {
        val stops = listOf(stop(3, "delivery"), stop(1, "pickup", "completed"), stop(2, "pickup", "skipped"), stop(4, "delivery"))
        assertEquals(NextAction.GoTo(stops[0]), DayLogic.nextActionOf(trip("in_progress"), stops))
        assertEquals(DayStep.DELIVER, DayLogic.stepOf(trip("in_progress"), stops))
    }

    @Test
    fun `the day is at Pick while a farm is still to visit`() {
        val stops = listOf(stop(1, "pickup", "completed"), stop(2, "pickup"), stop(3, "delivery"))
        assertEquals(DayStep.PICK, DayLogic.stepOf(trip("in_progress"), stops))
        assertEquals(Progress(1, 2), DayLogic.progressOf(stops, "pickup"))
        assertEquals(Progress(0, 1), DayLogic.progressOf(stops, "delivery"))
    }

    @Test
    fun `every stop done hands over, then waits for the owner`() {
        val stops = listOf(stop(1, "pickup", "completed"), stop(2, "delivery", "completed"))
        assertEquals(NextAction.Handover, DayLogic.nextActionOf(trip("in_progress"), stops))
        assertEquals(DayStep.SUMMARY, DayLogic.stepOf(trip("in_progress"), stops))
        assertEquals(NextAction.AwaitingOwner, DayLogic.nextActionOf(trip("completed"), stops))
        assertEquals(DayStep.COMPLETE, DayLogic.stepOf(trip("completed"), stops))
        assertEquals(NextAction.OnHold("Count the crates"), DayLogic.nextActionOf(trip("on_hold", "Count the crates"), stops))
    }

    @Test
    fun `distance to the next stop is the straight line times the road factor`() {
        // Two points in Mysuru about 3.6 km apart in a straight line.
        val straight = DayLogic.haversineKm(12.3052, 76.6552, 12.2770, 76.6720)
        assertTrue("straight line $straight", straight in 3.5..3.7)
        val eta = DayLogic.etaTo(12.3052, 76.6552, stop(1, "delivery", lat = 12.2770, lng = 76.6720))!!
        assertEquals(straight * DayLogic.ROAD_FACTOR, eta.km, 1e-9)
        // 4.7 km at 30 km/h.
        assertEquals(9, eta.minutes)
        assertEquals("4.7", DayLogic.kmLabel(eta.km))
    }

    @Test
    fun `no ETA without the phone's position or the stop's pin`() {
        assertNull(DayLogic.etaTo(null, null, stop(1, "delivery", lat = 12.0, lng = 76.0)))
        assertNull(DayLogic.etaTo(12.0, 76.0, stop(1, "delivery")))
    }

    @Test
    fun `a stop around the corner is still at least a minute away`() {
        assertEquals(1, DayLogic.etaTo(12.30000, 76.65000, stop(1, "delivery", lat = 12.30001, lng = 76.65001))!!.minutes)
    }

    @Test
    fun `greeting follows the hour`() {
        assertEquals(Greeting.MORNING, DayLogic.greetingAt(6))
        assertEquals(Greeting.AFTERNOON, DayLogic.greetingAt(12))
        assertEquals(Greeting.EVENING, DayLogic.greetingAt(17))
    }

    @Test
    fun `opening KM is required, a number with one decimal, never below the last reading`() {
        assertEquals(KmProblem.REQUIRED, DayLogic.openingKmProblem("  ", 48620.0))
        assertEquals(KmProblem.NOT_A_NUMBER, DayLogic.openingKmProblem("48,650", 48620.0))
        assertEquals(KmProblem.NOT_A_NUMBER, DayLogic.openingKmProblem("-5", null))
        assertEquals(KmProblem.ONE_DECIMAL, DayLogic.openingKmProblem("48650.25", 48620.0))
        assertEquals(KmProblem.BELOW_LAST, DayLogic.openingKmProblem("48600", 48620.0))
        assertNull(DayLogic.openingKmProblem("48620", 48620.0))
        assertNull(DayLogic.openingKmProblem("48650.5", 48620.0))
        assertNull(DayLogic.openingKmProblem("48650.50", 48620.0))
        assertNull(DayLogic.openingKmProblem("12", null))
    }

    @Test
    fun `money reads the Indian way`() {
        assertEquals("1,52,000", DayLogic.rupees("152000.00"))
        assertEquals("1,850", DayLogic.rupees("1850"))
        assertEquals("1,850.50", DayLogic.rupees("1850.50"))
        assertEquals("1,850.05", DayLogic.rupees("1850.05"))
        assertEquals("-6,200", DayLogic.rupees("-6200.00"))
        assertEquals("0", DayLogic.rupees("0.00"))
        assertEquals("1,23,45,678", DayLogic.rupees("12345678"))
        assertEquals("", DayLogic.rupees(null))
    }

    @Test
    fun `quantities drop trailing zeros and group`() {
        assertEquals("1,895", DayLogic.quantity("1895.000"))
        assertEquals("12.5", DayLogic.quantity("12.500"))
        assertEquals("0", DayLogic.quantity("0.000"))
        assertEquals("1,00,000.25", DayLogic.quantity("100000.250"))
        assertEquals("-200", DayLogic.quantity("-200.000"))
    }

    @Test
    fun `initials for the avatar`() {
        assertEquals("RD", DayLogic.initialsOf("Raju Driver"))
        assertEquals("R", DayLogic.initialsOf("raju"))
        assertEquals("", DayLogic.initialsOf(null))
    }
}
