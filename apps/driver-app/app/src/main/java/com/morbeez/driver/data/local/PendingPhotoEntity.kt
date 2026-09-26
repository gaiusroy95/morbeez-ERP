package com.morbeez.driver.data.local

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
    val stopId: String,
    val photoType: String, // pickup | delivery | pod | issue
    val localPath: String,
    val mimeType: String,
    val createdAt: Long,
    val status: String = "pending", // pending | failed_needs_review | done
)
