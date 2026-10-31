package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * An expense on the trip (D6): what the driver paid on the road, as the
 * server last listed it, and those recorded on this phone not sent yet.
 * A fuel expense keeps the pump's details — what the vehicle's mileage is
 * worked out from.
 */
@Entity(tableName = "expenses")
data class ExpenseEntity(
    @PrimaryKey val id: String,
    val tripId: String,
    /** fuel | toll | parking | labour (loading) | repair | other */
    val category: String,
    val amount: String,
    val notes: String? = null,
    /** ISO instant. */
    val recordedAt: String,
    val odometerKm: Int? = null,
    /** diesel | petrol | cng | electric */
    val fuelType: String? = null,
    val fullTank: Boolean? = null,
    val litres: String? = null,
    val ratePerLitre: String? = null,
    /** Beyond the driver's authority: the owner decides. */
    val needsApproval: Boolean = false,
    /** approved | rejected, once the owner has. */
    val decision: String? = null,
    val decisionNote: String? = null,
    /** Bill photos, here or already on the server. */
    val photos: Int = 0,
    /** Recorded on this phone, not sent yet. */
    val pendingSync: Boolean = false,
    /** cash | fastag: a toll or parking taken off the vehicle's FASTag isn't out of the driver's cash. */
    val paidBy: String = "cash",
)

@Dao
interface ExpenseDao {
    @Query("SELECT * FROM expenses WHERE tripId = :tripId ORDER BY recordedAt DESC, id")
    fun observeByTrip(tripId: String): Flow<List<ExpenseEntity>>

    @Query("SELECT * FROM expenses WHERE id = :id")
    suspend fun find(id: String): ExpenseEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(expense: ExpenseEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(expenses: List<ExpenseEntity>)

    /** The server's list replaces what it last said; what this phone hasn't sent stays. */
    @Query("DELETE FROM expenses WHERE tripId = :tripId AND pendingSync = 0")
    suspend fun clearSyncedForTrip(tripId: String)

    @Query("DELETE FROM expenses WHERE tripId != :keepTripId")
    suspend fun deleteAllExceptTrip(keepTripId: String)

    /** One the office refused, removed from the phone by the driver (D8). */
    @Query("DELETE FROM expenses WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM expenses")
    suspend fun clear()
}
