package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * The driver's day as the server last told it (GET logistics/trips/mine/day):
 * who they are, the planned vehicle and its last odometer reading, this
 * week's earnings and what's on the vehicle. One row, replaced on every pull,
 * so the Dashboard and Start Day work with no signal.
 */
@Entity(tableName = "driver_day")
data class DriverDayEntity(
    @PrimaryKey val id: Int = 0,
    /** The business's today, YYYY-MM-DD. */
    val today: String,
    val driverName: String?,
    val vehicleRegistration: String?,
    val routeName: String?,
    /** The vehicle's last odometer reading: Start Day's opening KM can't be below it. */
    val lastOdometerKm: String?,
    /** This week's earnings run from this Monday. */
    val weekFrom: String,
    val earnedThisWeek: String?,
    /** What's on the vehicle, as JSON (TripVehicleStockResponse). */
    val stockJson: String?,
    /** When the server last answered, epoch millis. */
    val refreshedAt: Long,
    /** The business's workers, as JSON (List<CrewOptionResponse>): the packer and loader are picked from them offline. */
    val crewJson: String? = null,
    /** The business's crate types, as JSON (List<CrateTypeResponse>). */
    val crateTypesJson: String? = null,
    /** The trip's collections, as JSON (TripCollectionsResponse), as the server last listed them (D4). */
    val collectionsJson: String? = null,
    /** What the driver raised that the owner decides, as JSON (DriverApprovalsResponse) (D6). */
    val approvalsJson: String? = null,
    /** The last 30 days' expenses and the vehicle's mileage, as JSON (MyExpensesResponse) (D6). */
    val myExpensesJson: String? = null,
    /** The vehicle the driver drives, as JSON (DriverVehicleResponse) (D6). */
    val vehicleJson: String? = null,
    /** Who the driver is and who to call, as JSON (DriverProfileResponse) (D6). */
    val profileJson: String? = null,
    /** My Earnings for today, this week and this month, as JSON (MyEarningsResponse) (D7). */
    val earningsTodayJson: String? = null,
    val earningsWeekJson: String? = null,
    val earningsMonthJson: String? = null,
    /** The driver's settlements, as JSON (List<DriverSettlementResponse>) (D7). */
    val settlementsJson: String? = null,
    /** How far the driver has read the conversation with the office (D9): ISO instant, by when the server had each message. */
    val chatReadAt: String? = null,
)

@Dao
interface DriverDayDao {
    @Query("SELECT * FROM driver_day WHERE id = 0")
    fun observe(): Flow<DriverDayEntity?>

    @Query("SELECT * FROM driver_day WHERE id = 0")
    suspend fun find(): DriverDayEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(day: DriverDayEntity)
}
