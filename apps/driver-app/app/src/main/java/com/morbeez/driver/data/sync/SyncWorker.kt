package com.morbeez.driver.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
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
    }
}
