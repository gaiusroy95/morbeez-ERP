package com.morbeez.driver.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * A captured photo waiting to reach the backend — kept separate from
 * PendingOperationEntity because its payload is a file on disk, not a
 * small JSON body. localPath points at the file FileProvider wrote when
 * the photo was captured (Driver App Architecture, DRV.19).
 */
@Entity(tableName = "pending_photos")
data class PendingPhotoEntity(
    @PrimaryKey val id: String,
    val tripId: String,
    /** The stop it's for — or, for a backhaul's or an expense's photo ([target]), the backhaul or the expense. */
    val stopId: String,
    val photoType: String, // pickup | delivery | pod | issue | weighment | load | rejection | payment; a backhaul's: load | drop | payment
    val localPath: String,
    val mimeType: String,
    val createdAt: Long,
    val status: String = "pending", // pending | failed_needs_review | done
    /** A farm stop's rejection photo: the product it shows. */
    val productId: String? = null,
    /** stop | backhaul (D5) | expense (D6, the bill): which upload it goes to. */
    @ColumnInfo(defaultValue = "stop") val target: String = "stop",
)
