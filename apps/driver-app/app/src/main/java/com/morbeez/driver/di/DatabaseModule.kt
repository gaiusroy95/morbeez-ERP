package com.morbeez.driver.di

import android.content.Context
import androidx.room.Room
import com.morbeez.driver.data.local.AppDatabase
import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.local.TripDao
import com.morbeez.driver.data.local.TripStopDao
import com.morbeez.driver.data.security.DatabaseKeyProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SupportFactory

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideAppDatabase(
        @ApplicationContext context: Context,
        databaseKeyProvider: DatabaseKeyProvider,
    ): AppDatabase {
        SQLiteDatabase.loadLibs(context)
        // The database file is encrypted at rest with a passphrase held in
        // the Keystore-backed store, not in code (Driver App Architecture,
        // DRV.10).
        val supportFactory = SupportFactory(databaseKeyProvider.getOrCreatePassphrase())
        return Room.databaseBuilder(context, AppDatabase::class.java, "morbeez-driver.db")
            .openHelperFactory(supportFactory)
            .build()
    }

    @Provides
    fun provideTripDao(db: AppDatabase): TripDao = db.tripDao()

    @Provides
    fun provideTripStopDao(db: AppDatabase): TripStopDao = db.tripStopDao()

    @Provides
    fun providePendingOperationDao(db: AppDatabase): PendingOperationDao = db.pendingOperationDao()

    @Provides
    fun providePendingPhotoDao(db: AppDatabase): PendingPhotoDao = db.pendingPhotoDao()
}
