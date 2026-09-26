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

    @Query("UPDATE pending_photos SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: String)

    @Query("DELETE FROM pending_photos WHERE id = :id")
    suspend fun delete(id: String)
}
