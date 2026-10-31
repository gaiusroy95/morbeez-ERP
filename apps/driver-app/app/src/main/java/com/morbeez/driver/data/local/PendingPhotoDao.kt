package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingPhotoDao {
    @Query("SELECT * FROM pending_photos WHERE status IN ('pending', 'failed_needs_review') ORDER BY createdAt ASC")
    suspend fun nextBatch(): List<PendingPhotoEntity>

    @Query("SELECT * FROM pending_photos WHERE stopId = :stopId")
    fun observeForStop(stopId: String): Flow<List<PendingPhotoEntity>>

    @Insert
    suspend fun insert(photo: PendingPhotoEntity)

    @Query("SELECT count(*) FROM pending_photos")
    suspend fun count(): Int

    @Query("UPDATE pending_photos SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: String)

    /** Refused, with the office's words (D8). */
    @Query("UPDATE pending_photos SET status = :status, lastError = :error WHERE id = :id")
    suspend fun markFailed(id: String, status: String, error: String)

    /** Photos the office refused, for the driver to see and remove (D8). */
    @Query("SELECT * FROM pending_photos WHERE status = 'failed_needs_review' ORDER BY createdAt ASC")
    fun observeFailed(): Flow<List<PendingPhotoEntity>>

    @Query("SELECT * FROM pending_photos WHERE id = :id")
    suspend fun find(id: String): PendingPhotoEntity?

    @Query("SELECT * FROM pending_photos WHERE stopId = :ownerId")
    suspend fun forOwner(ownerId: String): List<PendingPhotoEntity>

    @Query("DELETE FROM pending_photos WHERE id = :id")
    suspend fun delete(id: String)
}
