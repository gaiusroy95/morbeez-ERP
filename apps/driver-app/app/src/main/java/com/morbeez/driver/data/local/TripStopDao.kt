package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface TripStopDao {
    @Query("SELECT * FROM trip_stops WHERE tripId = :tripId ORDER BY sequenceNumber")
    fun observeByTrip(tripId: String): Flow<List<TripStopEntity>>

    @Query("SELECT * FROM trip_stops WHERE id = :stopId")
    suspend fun findById(stopId: String): TripStopEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(stop: TripStopEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(stops: List<TripStopEntity>)

    @Query("UPDATE trip_stops SET status = :status, pendingSync = :pendingSync WHERE id = :stopId")
    suspend fun updateStatus(stopId: String, status: String, pendingSync: Boolean)

    @Query("DELETE FROM trip_stops WHERE tripId = :tripId")
    suspend fun clearForTrip(tripId: String)

    @Query("DELETE FROM trip_stops WHERE tripId != :keepTripId")
    suspend fun deleteAllExceptTrip(keepTripId: String)

    @Query("DELETE FROM trip_stops")
    suspend fun clear()
}
