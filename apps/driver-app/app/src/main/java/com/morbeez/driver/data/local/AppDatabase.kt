package com.morbeez.driver.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * Room database — on-device source of truth while offline (System
 * Architecture, MOB.2). Every screen reads and writes here and only here
 * (Driver App Architecture, DRV.1); the network is reached exclusively
 * through the sync engine. Opened (in AppModule) with SQLCipher's
 * SupportFactory, so the file on disk is encrypted at rest
 * (Driver App Architecture, DRV.10).
 */
@Database(
    entities = [TripEntity::class, TripStopEntity::class, PendingOperationEntity::class, PendingPhotoEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tripDao(): TripDao
    abstract fun tripStopDao(): TripStopDao
    abstract fun pendingOperationDao(): PendingOperationDao
    abstract fun pendingPhotoDao(): PendingPhotoDao
}
