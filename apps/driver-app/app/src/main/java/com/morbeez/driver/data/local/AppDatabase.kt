package com.morbeez.driver.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

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
    version = 4,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tripDao(): TripDao
    abstract fun tripStopDao(): TripStopDao
    abstract fun pendingOperationDao(): PendingOperationDao
    abstract fun pendingPhotoDao(): PendingPhotoDao

    companion object {
        /** Trip handover: the owner's review note and the driver's declared cash. Queued actions are kept. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE trips ADD COLUMN reviewNote TEXT")
                db.execSQL("ALTER TABLE trips ADD COLUMN cashDeclared TEXT")
            }
        }

        /** Delegation: the driver's authority on the trip, and what to collect at each delivery. */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE trips ADD COLUMN authorityLevel INTEGER")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN collectTerms TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN collectAmount TEXT")
            }
        }

        /** Live birds and eggs: each stop keeps its lines, for farm and customer-end measures. */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN itemsJson TEXT")
            }
        }
    }
}
