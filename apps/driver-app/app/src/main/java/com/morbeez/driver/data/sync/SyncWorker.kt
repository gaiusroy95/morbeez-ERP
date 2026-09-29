package com.morbeez.driver.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * The WorkManager entry point (Driver App Architecture, DRV.5) — scheduled
 * both periodically and on network-regained/app-foregrounded triggers
 * (wired in MorbeezDriverApp). Guaranteed to eventually run even if the
 * process is killed mid-trip, which is the whole reason this isn't a
 * plain coroutine kicked off from a screen.
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val syncEngine: SyncEngine,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return when (syncEngine.sync()) {
            SyncResult.SUCCESS -> Result.success()
            SyncResult.PARTIAL -> Result.retry()
        }
    }

    companion object {
        const val UNIQUE_WORK_NAME = "morbeez-driver-sync"
        const val NOW_WORK_NAME = "morbeez-driver-sync-now"

        /**
         * One sync as soon as there's a network (Performance Audit PA-11).
         * Asking again while one is waiting or running joins it instead of
         * starting another — the app coming to the foreground, a Refresh tap
         * and the periodic pass used to stack up and race.
         */
        fun requestNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW_WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}
