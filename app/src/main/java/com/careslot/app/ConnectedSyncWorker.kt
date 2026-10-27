package com.careslot.app

import android.content.Context
import androidx.work.*
import java.io.IOException
import java.util.concurrent.TimeUnit

class ConnectedSyncWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val repository = ConnectedRepository(applicationContext)
        if (repository.vault.read()?.userId != inputData.getString("userId")) return Result.success()
        return try { repository.syncAll(); Result.success() }
        catch (_: IOException) { Result.retry() }
        catch (error: ClinicApiException) { if (error.status >= 500 || error.status == 429) Result.retry() else Result.failure() }
        catch (_: Exception) { Result.failure() }
    }
    companion object {
        private const val TAG = "careslot-connected-sync"
        fun schedule(context: Context, userId: String) {
            val work = PeriodicWorkRequestBuilder<ConnectedSyncWorker>(15, TimeUnit.MINUTES)
                .setInitialDelay(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
                .setInputData(workDataOf("userId" to userId)).addTag(TAG).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("$TAG-$userId", ExistingPeriodicWorkPolicy.UPDATE, work)
        }
        fun cancel(context: Context) { WorkManager.getInstance(context).cancelAllWorkByTag(TAG) }
    }
}
