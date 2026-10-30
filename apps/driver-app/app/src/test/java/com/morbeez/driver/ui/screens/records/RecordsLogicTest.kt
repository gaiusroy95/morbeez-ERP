package com.morbeez.driver.ui.screens.records

import com.morbeez.driver.data.remote.dto.DriverApprovalResponse
import com.morbeez.driver.data.remote.dto.DriverDocumentResponse
import com.morbeez.driver.data.remote.dto.DriverVehicleResponse
import com.morbeez.driver.data.remote.dto.MaintenanceDueResponse
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RecordsLogicTest {
    private fun item(id: String, kind: String, status: String) = DriverApprovalResponse(id = id, kind = kind, status = status, at = "2026-10-30T05:00:00Z")

    @Test
    fun `approvals by where they stand and what they are`() {
        val items = listOf(item("a", "expense", "pending"), item("b", "collection", "pending"), item("c", "expense", "approved"), item("d", "handover", "rejected"))
        assertEquals(listOf("a", "b"), RecordsLogic.approvals(items, "pending", "all").map { it.id })
        assertEquals(listOf("a"), RecordsLogic.approvals(items, "pending", "expense").map { it.id })
        assertEquals(1, RecordsLogic.countOf(items, "rejected", "handover"))
        assertEquals(0, RecordsLogic.countOf(items, "approved", "collection"))
    }

    @Test
    fun `the history's dates`() {
        val today = LocalDate.parse("2026-10-30")
        assertNull(RecordsLogic.rangeOf(HistoryRange.LAST_30_DAYS, today))
        assertEquals("2026-10-01" to "2026-10-30", RecordsLogic.rangeOf(HistoryRange.THIS_MONTH, today))
        assertEquals("2026-07-31" to "2026-10-30", RecordsLogic.rangeOf(HistoryRange.LAST_3_MONTHS, today))
    }

    @Test
    fun `what's due on the vehicle — overdue first, then the soonest`() {
        val v = DriverVehicleResponse(
            id = "v1", registrationNumber = "KA01D10001", fuelType = "diesel", ownership = "owned", status = "active",
            maintenance = listOf(
                MaintenanceDueResponse(kind = "service", description = "Engine oil change", lastDate = "2026-08-01", kmLeft = 1188, state = "due_soon"),
                MaintenanceDueResponse(kind = "tyres", description = "Tyre replacement", lastDate = "2026-05-01", kmLeft = 11188, state = "ok"),
            ),
            documents = listOf(
                DriverDocumentResponse(docType = "puc", validUntil = "2026-10-07", daysLeft = -23, state = "expired"),
                DriverDocumentResponse(docType = "insurance", validUntil = "2027-04-28", daysLeft = 180, state = "valid"),
                DriverDocumentResponse(docType = "permit", validUntil = "2026-11-12", daysLeft = 13, state = "expiring"),
            ),
        )
        val dues = RecordsLogic.duesOf(v)
        assertEquals(listOf("puc", "permit", "Engine oil change"), dues.map { it.what })
        assertEquals(emptyList<Due>(), RecordsLogic.duesOf(null))
    }

    @Test
    fun `a phone as people write it`() {
        assertEquals("98000 00001", RecordsLogic.phone("+919800000001"))
        assertEquals("owner@dev.morbeez.local", RecordsLogic.phone("owner@dev.morbeez.local"))
        assertNull(RecordsLogic.phone(null))
    }

    @Test
    fun `dates, times and time on the road`() {
        val ist = ZoneId.of("Asia/Kolkata")
        assertEquals("30 Oct 2026", RecordsFormat.date("2026-10-30"))
        assertEquals("30 Oct 2026", RecordsFormat.date("2026-10-30T02:45:00Z", ist))
        assertEquals("08:15 AM", RecordsFormat.clock("2026-10-30T02:45:00Z", ist))
        assertEquals("9h 20m", RecordsFormat.duration(560))
        assertEquals("45m", RecordsFormat.duration(45))
        assertNull(RecordsFormat.duration(null))
    }
}
