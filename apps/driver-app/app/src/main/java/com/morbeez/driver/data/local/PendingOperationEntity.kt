package com.morbeez.driver.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * The operation log itself (System Architecture MOB.3; Driver App
 * Architecture DRV.3/DRV.5). Every driver action becomes exactly one row
 * here before anything is sent over the network — the sync engine is the
 * only thing that ever reads this table.
 *
 * payloadJson carries whatever the specific operation needs (a Moshi-
 * serialized request body); idempotencyKey is generated once, at creation,
 * and reused on every retry so a redelivered request can never double-apply.
 */
@Entity(tableName = "pending_operations")
data class PendingOperationEntity(
    @PrimaryKey val idempotencyKey: String,
    val tripId: String,
    val operationType: String,
    val payloadJson: String,
    val createdAt: Long,
    val sequence: Long, // monotonic per-device — enforces DRV.7's ordering within a trip
    val status: String = "pending", // pending | in_flight | failed_needs_review | done
    val lastError: String? = null,
)
