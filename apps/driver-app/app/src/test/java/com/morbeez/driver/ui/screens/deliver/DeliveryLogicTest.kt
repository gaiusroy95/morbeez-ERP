package com.morbeez.driver.ui.screens.deliver

import com.morbeez.driver.data.local.CrateDraft
import com.morbeez.driver.data.local.DeliveryDraft
import com.morbeez.driver.data.local.QrState
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CrateTypeResponse
import com.morbeez.driver.data.remote.dto.DeliveredQuantity
import com.morbeez.driver.data.remote.dto.DeliveryCrates
import com.morbeez.driver.data.remote.dto.DeliveryLineMeasure
import com.morbeez.driver.data.remote.dto.DeliveryOutcomeResponse
import com.morbeez.driver.data.remote.dto.FarmStopLineResponse
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.data.remote.dto.TripVehicleStockResponse
import com.morbeez.driver.data.remote.dto.VehicleStockRowResponse
import java.math.BigDecimal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeliveryLogicTest {
    private val tomato = StopItemResponse("Tomato", "100.000", "kg", "p-tomato", orderLineId = "l-tomato")
    private val onion = StopItemResponse("Onion", "50.000", "kg", "p-onion", orderLineId = "l-onion")
    private val items = listOf(tomato, onion)
    private val crateTypes = listOf(CrateTypeResponse("c-1", "DL20", "Delivery crate"))

    private fun draft(change: (DeliveryDraft) -> DeliveryDraft = { it }) =
        change(DeliveryLogic.withItems(DeliveryDraft(), items, crateTypes, "Hotel Sagar"))

    private fun DeliveryDraft.line(id: String, change: (com.morbeez.driver.data.local.DeliveryLineDraft) -> com.morbeez.driver.data.local.DeliveryLineDraft) =
        copy(lines = lines.map { if (it.orderLineId == id) change(it) else it })

    @Test
    fun `the shop's own QR matches, printed or bare, in any case, another shop's never`() {
        assertTrue(DeliveryLogic.qrMatches("MORBEEZ:C:ABCD1234EF567890", "ABCD1234EF567890"))
        assertTrue(DeliveryLogic.qrMatches(" morbeez:c:abcd1234ef567890 ", "ABCD1234EF567890"))
        assertTrue(DeliveryLogic.qrMatches("abcd1234ef567890", "ABCD1234EF567890"))
        assertFalse(DeliveryLogic.qrMatches("MORBEEZ:C:FFFF0000FFFF0000", "ABCD1234EF567890"))
        assertFalse(DeliveryLogic.qrMatches("MORBEEZ:C:ABCD1234EF567890", null))
    }

    @Test
    fun `a delivery starts as ordered, with the shop as who received it and a row per crate type`() {
        val d = draft()
        assertEquals(listOf("100", "50"), d.lines.map { it.delivered })
        assertEquals("Hotel Sagar", d.recipient)
        assertEquals(listOf(CrateDraft("c-1")), d.crates)
    }

    @Test
    fun `less than ordered needs a reason, more doesn't`() {
        var d = draft { it.line("l-onion") { l -> l.copy(delivered = "40") } }
        assertEquals(DeliveryProblem.NO_REASON, DeliveryLogic.problemOf(d.lines[1], onion))
        d = d.line("l-onion") { it.copy(shortReason = "customer_took_less") }
        assertNull(DeliveryLogic.problemOf(d.lines[1], onion))
        d = d.line("l-tomato") { it.copy(delivered = "110") }
        assertNull(DeliveryLogic.problemOf(d.lines[0], tomato))
        assertEquals(DeliveryProblem.BAD_NUMBER, DeliveryLogic.problemOf(d.lines[0].copy(delivered = "1.2.3"), tomato))
    }

    @Test
    fun `nothing completes without the QR or why not, the quantities, everything unloaded and a photo`() {
        var d = draft()
        var r = DeliveryLogic.readinessOf(d, items)
        assertFalse(r.qr || r.unloaded || r.photo)
        assertTrue(r.quantities && r.recipient)
        d = d.copy(qr = QrState.NOT_SCANNED, qrNote = "QR missing", allUnloaded = true, podPhotos = 1)
        assertTrue(DeliveryLogic.readinessOf(d, items).ready)
        r = DeliveryLogic.readinessOf(d.copy(qrNote = null), items)
        assertFalse(r.qr)
    }

    @Test
    fun `what is sent, only lines that differ, the reason when short, the scanned QR, crates given`() {
        val d = draft {
            it.line("l-onion") { l -> l.copy(delivered = "40", shortReason = "damaged", shortNote = " crushed ") }
                .copy(qr = QrState.VERIFIED, qrValue = "MORBEEZ:C:ABCD", allUnloaded = true, crates = listOf(CrateDraft("c-1", dropped = "10", collected = "")))
        }
        val request = DeliveryLogic.requestOf(d, items)
        assertEquals(listOf(DeliveryLineMeasure("l-onion", deliveredQuantity = 40.0, shortReason = "damaged", shortNote = "crushed")), request.lines)
        assertEquals("MORBEEZ:C:ABCD", request.qrToken)
        assertNull(request.qrNote)
        assertEquals(true, request.allUnloaded)
        assertEquals(listOf(DeliveryCrates("c-1", 10, 0)), request.crates)
        assertEquals("Hotel Sagar", request.recipientName)
    }

    @Test
    fun `a QR not scanned sends why, no crates sends none`() {
        val request = DeliveryLogic.requestOf(draft { it.copy(qr = QrState.NOT_SCANNED, qrNote = "QR damaged") }, items)
        assertNull(request.qrToken)
        assertEquals("QR damaged", request.qrNote)
        assertNull(request.crates)
        assertTrue(request.lines.isEmpty())
    }

    @Test
    fun `until the server answers, the phone shows the delivery as sent and counts it off the vehicle`() {
        val d = draft { it.line("l-onion") { l -> l.copy(delivered = "40", shortReason = "customer_took_less") }.copy(qr = QrState.VERIFIED, qrValue = "X", allUnloaded = true) }
        val outcome = DeliveryLogic.outcomeOf(d, items)
        assertEquals("scanned", outcome.qrStatus)
        assertEquals(1, outcome.shortfalls.size)
        assertEquals("40.000", outcome.shortfalls[0].delivered)
        assertEquals(listOf(DeliveredQuantity("p-tomato", "100.000"), DeliveredQuantity("p-onion", "40.000")), outcome.delivered)
    }

    private fun stop(id: String, seq: Int, type: String, status: String = "pending", pending: Boolean = false) = TripStopEntity(
        id = id, tripId = "t1", sequenceNumber = seq, stopType = type, status = status, pickupId = null, orderId = null,
        counterpartyName = id, summary = "", notes = null, pendingSync = pending,
    )

    @Test
    fun `shops are delivered in visiting order, the first not done is next`() {
        val stops = listOf(stop("farm", 1, "pickup"), stop("b", 3, "delivery"), stop("a", 2, "delivery", "completed"), stop("c", 4, "delivery"))
        assertEquals("b", DeliveryLogic.nextDelivery(stops)?.id)
        assertNull(DeliveryLogic.nextDelivery(stops.map { it.copy(status = "completed") }))
    }

    @Test
    fun `vehicle stock, the server's count, plus farms and minus deliveries the server hasn't counted yet`() {
        val snapshot = TripVehicleStockResponse(
            "t1", "v1", "KA01",
            rows = listOf(VehicleStockRowResponse("p-tomato", "Tomato", "kg", "100.000", "100.000", "0.000", "100.000", "0.000")),
        )
        val stops = listOf(stop("farm", 1, "pickup", "completed", pending = true), stop("shop", 2, "delivery", "completed", pending = true), stop("done", 3, "delivery", "completed"))
        val farms = mapOf("farm" to FarmStopOutcomeResponse(lines = listOf(FarmStopLineResponse("p-onion", "Onion", "kg", "accepted", "60.000"))))
        val deliveries = mapOf(
            "shop" to DeliveryOutcomeResponse(delivered = listOf(DeliveredQuantity("p-tomato", "70.000"))),
            // Already counted by the server: not taken off again.
            "done" to DeliveryOutcomeResponse(delivered = listOf(DeliveredQuantity("p-tomato", "30.000"))),
        )
        val lines = DeliveryLogic.stockOf(snapshot, stops, farms, deliveries) { s -> if (s.id == "shop") listOf(tomato.copy(quantity = "70.000")) else emptyList() }
        val byId = lines.associateBy { it.productId }
        assertEquals(BigDecimal("30.000"), byId.getValue("p-tomato").onVehicle)
        assertEquals(BigDecimal("30.000"), byId.getValue("p-tomato").toDeliver)
        assertEquals(BigDecimal("60.000"), byId.getValue("p-onion").onVehicle)
        assertEquals(BigDecimal("90.000"), DeliveryLogic.kgOf(lines) { it.onVehicle })
    }
}
