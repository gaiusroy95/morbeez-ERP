package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * A backhaul on the trip (D5): a fixed-rent job on the way back — no
 * product, no kilos, no stock. As the server last listed it, with anything
 * done on this phone since applied at once (the queue sends it).
 */
@Entity(tableName = "backhauls")
data class BackhaulEntity(
    @PrimaryKey val id: String,
    val tripId: String,
    val pickupPlace: String,
    val dropPlace: String,
    val rent: String,
    val hirerName: String? = null,
    val notes: String? = null,
    /** owner | driver: the owner offered it, or the driver took it on the road. */
    val offeredBy: String,
    /** offered | accepted | skipped | cancelled | completed */
    val status: String,
    val skipReason: String? = null,
    val acceptedAt: String? = null,
    val pickupReachedAt: String? = null,
    val loadedAt: String? = null,
    val dropReachedAt: String? = null,
    val completedAt: String? = null,
    /** cash | upi | bank_transfer, once paid. */
    val paymentMethod: String? = null,
    val amountReceived: String? = null,
    val paymentReference: String? = null,
    val paidAt: String? = null,
    /** Photos taken, here or already on the server. */
    val loadPhotos: Int = 0,
    val dropPhotos: Int = 0,
    val paymentPhotos: Int = 0,
    val createdAt: String,
    /** Changed on this phone, not sent yet. */
    val pendingSync: Boolean = false,
)

@Dao
interface BackhaulDao {
    @Query("SELECT * FROM backhauls WHERE tripId = :tripId ORDER BY createdAt, id")
    fun observeByTrip(tripId: String): Flow<List<BackhaulEntity>>

    @Query("SELECT * FROM backhauls WHERE id = :id")
    suspend fun find(id: String): BackhaulEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(backhaul: BackhaulEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(backhauls: List<BackhaulEntity>)

    @Query("DELETE FROM backhauls WHERE tripId = :tripId")
    suspend fun clearForTrip(tripId: String)

    @Query("DELETE FROM backhauls WHERE tripId != :keepTripId")
    suspend fun deleteAllExceptTrip(keepTripId: String)

    @Query("DELETE FROM backhauls")
    suspend fun clear()
}
