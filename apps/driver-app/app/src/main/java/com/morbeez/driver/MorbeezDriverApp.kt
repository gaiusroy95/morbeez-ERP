package com.morbeez.driver

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.HiltAndroidApp
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Offline-first driver app. Room is the source of truth while offline; a
 * WorkManager-driven sync engine reconciles with the backend
 * opportunistically (System Architecture, MOB.2-MOB.3; Driver App
 * Architecture, DRV.1-DRV.9).
 */
@HiltAndroidApp
class MorbeezDriverApp : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        schedulePeriodicSync()
    }

    // A periodic pass is the fallback; MainActivity also enqueues an
    // immediate one-off sync on network-regained/app-foregrounded so a
    // driver's action doesn't wait for the next 15-minute tick if
    // connectivity comes back sooner (Driver App Architecture, DRV.5).
    private fun schedulePeriodicSync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            SyncWorker.UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}
