package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * A stop being worked on, as JSON — a farm (FarmDraft, D2) or a delivery
 * (DeliveryDraft, D3). Kept on the phone so an interrupted visit picks up
 * where it was; everything stays editable until hold-to-complete, when it's
 * sent and this is deleted.
 */
@Entity(tableName = "stop_drafts")
data class StopDraftEntity(
    @PrimaryKey val stopId: String,
    val tripId: String,
    val json: String,
    val updatedAt: Long,
)

@Dao
interface StopDraftDao {
    @Query("SELECT * FROM stop_drafts WHERE stopId = :stopId")
    fun observe(stopId: String): Flow<StopDraftEntity?>

    @Query("SELECT * FROM stop_drafts WHERE stopId = :stopId")
    suspend fun find(stopId: String): StopDraftEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(draft: StopDraftEntity)

    @Query("DELETE FROM stop_drafts WHERE stopId = :stopId")
    suspend fun delete(stopId: String)

    /** Drafts of a trip this phone no longer has. */
    @Query("DELETE FROM stop_drafts WHERE tripId != :keepTripId")
    suspend fun deleteAllExceptTrip(keepTripId: String)

    @Query("DELETE FROM stop_drafts")
    suspend fun clear()
}

enum class Decision { ACCEPTED, REJECTED }

/** One product at the farm, as the driver has it so far — numbers as typed. */
data class FarmLineDraft(
    val productId: String,
    val decision: Decision? = null,
    /** By weight: the net quantity, in the product's unit. */
    val weight: String = "",
    /** Sacks (bags) packed; by bags, how many. */
    val sacks: String = "",
    /** By bags: kg in each. */
    val kgPerBag: String = "",
    val reason: String? = null,
    val note: String = "",
    val rejectionPhoto: Boolean = false,
)

/** The farm stop so far (driver app D2), kept on the phone until hold-to-complete. */
data class FarmDraft(
    val lines: List<FarmLineDraft> = emptyList(),
    /** Counted in bags of a set weight rather than weighed (kg products). */
    val byBags: Boolean = false,
    val packerId: String? = null,
    val loaderId: String? = null,
    /** One worker packs and loads. */
    val samePerson: Boolean = false,
    val loadPhotos: Int = 0,
)

/** Where the shop's QR stands (client spec §12; the client's answer 5). */
enum class QrState { NONE, VERIFIED, NOT_SCANNED }

/** One order line at the shop, as the driver has it so far — numbers as typed. */
data class DeliveryLineDraft(
    val orderLineId: String,
    /** What left the vehicle for it; starts at what was ordered. */
    val delivered: String = "",
    /** Delivered short: why (customer_took_less | damaged | not_enough_on_vehicle | quality_issue | other). */
    val shortReason: String? = null,
    val shortNote: String = "",
    /** Live birds: net kg on the customer's scale. */
    val customerWeight: String = "",
    /** Eggs: broken on the way. */
    val broken: String = "",
)

/** Crates of one type at the shop: left with them, taken back. */
data class CrateDraft(val crateTypeId: String, val dropped: String = "", val collected: String = "")

/** The delivery so far (driver app D3), kept on the phone until hold-to-complete. */
data class DeliveryDraft(
    val qr: QrState = QrState.NONE,
    /** What was scanned, once it matched. */
    val qrValue: String? = null,
    /** Not scanned: why (missing, damaged, …). */
    val qrNote: String? = null,
    val lines: List<DeliveryLineDraft> = emptyList(),
    val allUnloaded: Boolean = false,
    val crates: List<CrateDraft> = emptyList(),
    /** Who received it; starts as the shop's name. */
    val recipient: String = "",
    val podPhotos: Int = 0,
    val scalePhotos: Int = 0,
)
