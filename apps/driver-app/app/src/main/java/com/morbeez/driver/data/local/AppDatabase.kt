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
    entities = [
        TripEntity::class,
        TripStopEntity::class,
        PendingOperationEntity::class,
        PendingPhotoEntity::class,
        DriverDayEntity::class,
        StopDraftEntity::class,
        BackhaulEntity::class,
        ExpenseEntity::class,
        ChatMessageEntity::class,
    ],
    version = 12,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun tripDao(): TripDao
    abstract fun tripStopDao(): TripStopDao
    abstract fun pendingOperationDao(): PendingOperationDao
    abstract fun pendingPhotoDao(): PendingPhotoDao
    abstract fun driverDayDao(): DriverDayDao
    abstract fun stopDraftDao(): StopDraftDao
    abstract fun backhaulDao(): BackhaulDao
    abstract fun expenseDao(): ExpenseDao
    abstract fun chatDao(): ChatDao

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

        /** Driver app V1 (D1): the driver's day, Start Day's readings, each stop's phone and map pin. */
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE trips ADD COLUMN number TEXT")
                db.execSQL("ALTER TABLE trips ADD COLUMN openingKm TEXT")
                db.execSQL("ALTER TABLE trips ADD COLUMN startedAt TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN partyPhone TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN partyPlace TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN partyAddress TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN partyLatitude REAL")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN partyLongitude REAL")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `driver_day` (`id` INTEGER NOT NULL, `today` TEXT NOT NULL, " +
                        "`driverName` TEXT, `vehicleRegistration` TEXT, `routeName` TEXT, `lastOdometerKm` TEXT, " +
                        "`weekFrom` TEXT NOT NULL, `earnedThisWeek` TEXT, `stockJson` TEXT, `refreshedAt` INTEGER NOT NULL, " +
                        "PRIMARY KEY(`id`))",
                )
            }
        }

        /** Driver app V1 (D2): the farmer stop — its draft on the phone, arrival, outcome, crew to pick from, a photo's product. */
        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN arrivedAt TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN farmJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN crewJson TEXT")
                db.execSQL("ALTER TABLE pending_photos ADD COLUMN productId TEXT")
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `stop_drafts` (`stopId` TEXT NOT NULL, `tripId` TEXT NOT NULL, " +
                        "`json` TEXT NOT NULL, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`stopId`))",
                )
            }
        }

        /** Driver app V1 (D3): Start Trip, each shop's QR, a delivery's outcome on the phone, the crate types. */
        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE trips ADD COLUMN deliveryStartedAt TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN partyQrToken TEXT")
                db.execSQL("ALTER TABLE trip_stops ADD COLUMN deliveryJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN crateTypesJson TEXT")
            }
        }

        /** Driver app V1 (D4): Return's closing KM, the trip's collections as the server last listed them. */
        val MIGRATION_7_8 = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE trips ADD COLUMN closingKm TEXT")
                db.execSQL("ALTER TABLE trips ADD COLUMN returnedAt TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN collectionsJson TEXT")
            }
        }

        /** Driver app V1 (D5): the trip's backhauls; a photo goes to a stop or a backhaul. */
        val MIGRATION_8_9 = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `backhauls` (`id` TEXT NOT NULL, `tripId` TEXT NOT NULL, `pickupPlace` TEXT NOT NULL, " +
                        "`dropPlace` TEXT NOT NULL, `rent` TEXT NOT NULL, `hirerName` TEXT, `notes` TEXT, `offeredBy` TEXT NOT NULL, " +
                        "`status` TEXT NOT NULL, `skipReason` TEXT, `acceptedAt` TEXT, `pickupReachedAt` TEXT, `loadedAt` TEXT, " +
                        "`dropReachedAt` TEXT, `completedAt` TEXT, `paymentMethod` TEXT, `amountReceived` TEXT, `paymentReference` TEXT, " +
                        "`paidAt` TEXT, `loadPhotos` INTEGER NOT NULL, `dropPhotos` INTEGER NOT NULL, `paymentPhotos` INTEGER NOT NULL, " +
                        "`createdAt` TEXT NOT NULL, `pendingSync` INTEGER NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL("ALTER TABLE pending_photos ADD COLUMN target TEXT NOT NULL DEFAULT 'stop'")
            }
        }

        /** Driver app V1 (D6): the trip's expenses with their pump details; the driver's approvals, expenses, vehicle and profile as last read. */
        val MIGRATION_9_10 = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `expenses` (`id` TEXT NOT NULL, `tripId` TEXT NOT NULL, `category` TEXT NOT NULL, " +
                        "`amount` TEXT NOT NULL, `notes` TEXT, `recordedAt` TEXT NOT NULL, `odometerKm` INTEGER, `fuelType` TEXT, " +
                        "`fullTank` INTEGER, `litres` TEXT, `ratePerLitre` TEXT, `needsApproval` INTEGER NOT NULL, `decision` TEXT, " +
                        "`decisionNote` TEXT, `photos` INTEGER NOT NULL, `pendingSync` INTEGER NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL("ALTER TABLE driver_day ADD COLUMN approvalsJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN myExpensesJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN vehicleJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN profileJson TEXT")
            }
        }

        /** Driver app V1 (D7): My Earnings (today, this week, this month) and the settlements, as last read. */
        val MIGRATION_10_11 = object : Migration(10, 11) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE driver_day ADD COLUMN earningsTodayJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN earningsWeekJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN earningsMonthJson TEXT")
                db.execSQL("ALTER TABLE driver_day ADD COLUMN settlementsJson TEXT")
            }
        }

        /** Driver app V1 (D9): the conversation with the office, and how far the driver has read it. */
        val MIGRATION_11_12 = object : Migration(11, 12) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    "CREATE TABLE IF NOT EXISTS `chat_messages` (`id` TEXT NOT NULL, `side` TEXT NOT NULL, `senderName` TEXT NOT NULL, " +
                        "`body` TEXT, `tripId` TEXT, `tripNumber` TEXT, `photo` TEXT NOT NULL, `localPhotoPath` TEXT, " +
                        "`writtenAt` TEXT NOT NULL, `createdAt` TEXT, `pendingSync` INTEGER NOT NULL, PRIMARY KEY(`id`))",
                )
                db.execSQL("ALTER TABLE driver_day ADD COLUMN chatReadAt TEXT")
            }
        }
    }
}
