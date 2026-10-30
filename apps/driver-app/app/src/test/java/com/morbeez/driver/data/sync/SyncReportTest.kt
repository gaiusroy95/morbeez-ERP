package com.morbeez.driver.data.sync

import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoEntity
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SyncReportTest {
    private val now = Instant.parse("2026-10-30T10:00:00Z")
    private fun op(key: String, at: Long, failed: String? = null) = PendingOperationEntity(
        idempotencyKey = key, tripId = "t1", operationType = if (failed != null) "START_TRIP" else "RECORD_COLLECTION", payloadJson = "{}",
        createdAt = at, sequence = at, status = if (failed != null) "failed_needs_review" else "pending", lastError = failed,
    )
    private fun photo(id: String, at: Long, status: String = "pending") =
        PendingPhotoEntity(id = id, tripId = "t1", stopId = "s1", photoType = "pod", localPath = "/x.jpg", mimeType = "image/jpeg", createdAt = at, status = status)

    @Test
    fun `what is still on the phone, what the server refused and in its words`() {
        val r = SyncReport.of(
            "phone-1", "0.1.0",
            listOf(op("a", 1_000, failed = "Opening KM 48600 is below the vehicle's last reading 48620"), op("b", 2_000)),
            listOf(photo("p", 500), photo("q", 3_000, "failed_needs_review")),
            SyncResult.PARTIAL, now,
        )
        assertEquals(2, r.pendingOperations)
        assertEquals(1, r.failedOperations)
        assertEquals(2, r.pendingPhotos)
        assertEquals(1, r.failedPhotos)
        assertEquals("START_TRIP", r.failures.single().type)
        assertEquals("Opening KM 48600 is below the vehicle's last reading 48620", r.failures.single().error)
        // The oldest thing waiting, photo or action.
        assertEquals("1970-01-01T00:00:00.500Z", r.oldestPendingAt)
        assertEquals("partial", r.lastResult)
        assertEquals("2026-10-30T10:00:00Z", r.syncedAt)
    }

    @Test
    fun `an empty queue - nothing waiting, nothing refused`() {
        val r = SyncReport.of("phone-1", "0.1.0", emptyList(), emptyList(), SyncResult.SUCCESS, now)
        assertEquals(0, r.pendingOperations)
        assertNull(r.oldestPendingAt)
        assertEquals("success", r.lastResult)
    }

    @Test
    fun `at most twenty refusals are sent`() {
        val r = SyncReport.of("phone-1", "0.1.0", (1..25).map { op("k$it", it.toLong(), failed = "no") }, emptyList(), SyncResult.PARTIAL, now)
        assertEquals(25, r.failedOperations)
        assertEquals(SyncReport.MAX_FAILURES, r.failures.size)
    }
}
