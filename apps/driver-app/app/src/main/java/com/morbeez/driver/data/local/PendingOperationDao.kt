package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingOperationDao {
    // Strict order within a trip (Driver App Architecture, DRV.7) — the
    // sync engine always drains oldest-sequence-first.
    @Query("SELECT * FROM pending_operations WHERE status IN ('pending', 'failed_needs_review') ORDER BY sequence ASC")
    suspend fun nextBatch(): List<PendingOperationEntity>

    @Query("SELECT * FROM pending_operations WHERE status = 'failed_needs_review' ORDER BY sequence ASC")
    fun observeFailed(): Flow<List<PendingOperationEntity>>

    @Insert
    suspend fun insert(operation: PendingOperationEntity)

    @Query("UPDATE pending_operations SET status = :status WHERE idempotencyKey = :key")
    suspend fun updateStatus(key: String, status: String)

    @Query("UPDATE pending_operations SET status = :status, lastError = :error WHERE idempotencyKey = :key")
    suspend fun markFailed(key: String, status: String, error: String)

    @Query("DELETE FROM pending_operations WHERE idempotencyKey = :key")
    suspend fun delete(key: String)

    /** Actions recorded on this phone that the server hasn't confirmed yet. */
    @Query("SELECT count(*) FROM pending_operations")
    suspend fun count(): Int

    @Query("SELECT count(*) FROM pending_operations WHERE status = 'pending'")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COALESCE(MAX(sequence), 0) FROM pending_operations")
    suspend fun maxSequence(): Long
}
