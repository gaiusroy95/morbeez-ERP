package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface TripDao {
    // The driver's trip until the owner closes it: on the road, or submitted and awaiting the owner.
    @Query("SELECT * FROM trips WHERE status IN ('in_progress', 'planned', 'completed', 'on_hold') LIMIT 1")
    fun observeActiveTrip(): Flow<TripEntity?>

    @Query("SELECT * FROM trips WHERE status IN ('in_progress', 'planned', 'completed', 'on_hold') LIMIT 1")
    suspend fun findActiveTrip(): TripEntity?

    /** Submitted on this phone, before the server has heard: shown as awaiting the owner straight away. */
    @Query("UPDATE trips SET status = 'completed', cashDeclared = :cashDeclared WHERE id = :tripId")
    suspend fun markSubmitted(tripId: String, cashDeclared: String?)

    @Query("SELECT * FROM trips WHERE id = :tripId")
    suspend fun findById(tripId: String): TripEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(trip: TripEntity)

    @Query("DELETE FROM trips WHERE id = :tripId")
    suspend fun deleteById(tripId: String)

    @Query("DELETE FROM trips")
    suspend fun clear()

    /** Every trip but the one the server says is current — a closed, cancelled or reassigned one must not linger. */
    @Query("DELETE FROM trips WHERE id != :keepId")
    suspend fun deleteAllExcept(keepId: String)
}
