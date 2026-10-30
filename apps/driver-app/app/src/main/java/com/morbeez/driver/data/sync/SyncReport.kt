package com.morbeez.driver.data.sync

import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.remote.dto.SyncFailure
import com.morbeez.driver.data.remote.dto.SyncReportRequest
import java.time.Instant

/**
 * What this phone tells the office after a sync pass (owner Phase 8, the
 * Offline Sync screen): how much is still on it, what the server refused
 * and in its words — so the owner sees a phone that hasn't sent the day's
 * work, and why. Counts only; the actions themselves stay here (DRV.5).
 */
object SyncReport {
    /** The server keeps at most this many refusals. */
    const val MAX_FAILURES = 20

    fun of(
        deviceId: String,
        appVersion: String,
        operations: List<PendingOperationEntity>,
        photos: List<PendingPhotoEntity>,
        result: SyncResult,
        now: Instant,
    ): SyncReportRequest {
        val failed = operations.filter { it.status == "failed_needs_review" }
        val oldest = (operations.map { it.createdAt } + photos.map { it.createdAt }).minOrNull()
        return SyncReportRequest(
            deviceId = deviceId,
            platform = "android",
            appVersion = appVersion,
            pendingOperations = operations.size,
            failedOperations = failed.size,
            pendingPhotos = photos.size,
            failedPhotos = photos.count { it.status == "failed_needs_review" },
            oldestPendingAt = oldest?.let { Instant.ofEpochMilli(it).toString() },
            failures = failed.take(MAX_FAILURES).map {
                SyncFailure(type = it.operationType, error = (it.lastError ?: "").take(500), at = Instant.ofEpochMilli(it.createdAt).toString())
            },
            lastResult = if (result == SyncResult.SUCCESS) "success" else "partial",
            syncedAt = now.toString(),
        )
    }
}
