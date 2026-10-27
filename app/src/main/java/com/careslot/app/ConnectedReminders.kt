package com.careslot.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.*
import org.json.JSONArray
import java.time.Instant
import java.util.concurrent.TimeUnit
import java.io.IOException

/** Scheduling identities contain no medicine or clinician details. Delivery rechecks the live visit. */
object ConnectedReminders {
    private const val TAG = "connected-visit-reminders"
    private const val CHANNEL = "connected-visits"
    private fun prefs(c: Context) = c.getSharedPreferences("connected_reminders", Context.MODE_PRIVATE)
    fun enabled(c: Context, user: String) = prefs(c).getBoolean("enabled-$user", false)
    fun permitted(c: Context) = (Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && c.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
    fun setEnabled(c: Context, user: String, value: Boolean) {
        prefs(c).edit().putBoolean("enabled-$user", value).commit()
        if (!value) cancelScheduled(c, user)
    }
    private fun cancelScheduled(c: Context, user: String) {
        val work = WorkManager.getInstance(c)
        for (name in prefs(c).getStringSet("scheduled-$user", emptySet())!!.toSet()) {
            work.cancelUniqueWork(name); c.getSystemService(NotificationManager::class.java).cancel(name, 1)
        }
        work.cancelAllWorkByTag("$TAG-$user")
        prefs(c).edit().remove("scheduled-$user").commit()
    }
    fun clear(c: Context, user: String) {
        cancelScheduled(c, user)
        val edit = prefs(c).edit()
        for (key in prefs(c).all.keys) if (key == "enabled-$user" || key.startsWith("delivered-$user-")) edit.remove(key)
        edit.commit()
    }
    fun reconcile(c: Context, user: String, items: JSONArray) = synchronized(SessionVault.lock) {
        if (SessionVault(c).read()?.userId != user || !enabled(c, user)) return@synchronized
        val next = mutableSetOf<String>(); val manager = WorkManager.getInstance(c)
        for (index in 0 until items.length()) {
            val visit = items.getJSONObject(index)
            val start = Instant.parse(visit.getString("startsAt")).toEpochMilli()
            if (visit.getString("status") != "BOOKED" || start <= System.currentTimeMillis()) continue
            val name = "$TAG-$user-${visit.getString("id")}-${visit.getInt("version")}"
            next.add(name)
            if (prefs(c).getBoolean("delivered-$user-$name", false)) continue
            val delay = (start - TimeUnit.HOURS.toMillis(24) - System.currentTimeMillis()).coerceAtLeast(5000)
            val request = OneTimeWorkRequestBuilder<ConnectedReminderWorker>()
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .setInputData(workDataOf("userId" to user, "visitId" to visit.getString("id"), "version" to visit.getInt("version"), "name" to name))
                .addTag(TAG).addTag("$TAG-$user").build()
            manager.enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)
        }
        for (old in prefs(c).getStringSet("scheduled-$user", emptySet())!!.toSet() - next) { manager.cancelUniqueWork(old); c.getSystemService(NotificationManager::class.java).cancel(old, 1) }
        prefs(c).edit().putStringSet("scheduled-$user", next).commit()
    }
    fun notify(c: Context, user: String, name: String, test: Boolean = false) = synchronized(SessionVault.lock) {
        if (SessionVault(c).read()?.userId != user || !permitted(c) || !enabled(c, user)) return@synchronized
        val manager = c.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Appointment reminders", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Reminders for your confirmed CareSlot visits" })
        val intent = Intent(c, ConnectedActivity::class.java).putExtra("openVisits", true).putExtra("reminderUserId", user).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(c, name.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(name, 1, Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(if (test) "CareSlot test reminder" else "Your appointment is coming up")
            .setContentText(if (test) "This is a test notification. Tap to open My visits." else "Open My visits to check your confirmed time and clinic details.")
            .setContentIntent(pending).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build())
        if (!test) prefs(c).edit().putBoolean("delivered-$user-$name", true).commit()
    }
    fun test(c: Context, user: String) {
        if (!BuildConfig.DEBUG) return
        val name = "$TAG-$user-test"
        val work = OneTimeWorkRequestBuilder<ConnectedReminderWorker>().setInitialDelay(10, TimeUnit.SECONDS)
            .setInputData(workDataOf("userId" to user, "name" to name, "test" to true)).addTag(TAG).addTag("$TAG-$user").build()
        prefs(c).edit().putStringSet("scheduled-$user", prefs(c).getStringSet("scheduled-$user", emptySet())!!.toSet() + name).commit()
        WorkManager.getInstance(c).enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, work)
    }
}

class ConnectedReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val user = inputData.getString("userId") ?: return Result.failure()
        val name = inputData.getString("name") ?: return Result.failure()
        val repository = ConnectedRepository(applicationContext)
        if (repository.vault.read()?.userId != user || !ConnectedReminders.enabled(applicationContext, user)) return Result.success()
        if (BuildConfig.DEBUG && inputData.getBoolean("test", false)) { ConnectedReminders.notify(applicationContext, user, name, true); return Result.success() }
        return try {
            val items = repository.reminderVisits()
            ConnectedReminders.reconcile(applicationContext, user, items)
            val visit = (0 until items.length()).map { items.getJSONObject(it) }.find { it.getString("id") == inputData.getString("visitId") }
            if (visit != null && visit.getInt("version") == inputData.getInt("version", -1) && visit.getString("status") == "BOOKED" && Instant.parse(visit.getString("startsAt")).isAfter(Instant.now())) ConnectedReminders.notify(applicationContext, user, name)
            Result.success()
        } catch (_: IOException) { if (runAttemptCount < 10) Result.retry() else Result.failure() }
        catch (e: ClinicApiException) { if (e.status == 429 || e.status >= 500) Result.retry() else { if (e.status == 401) repository.signOut(true); Result.failure() } }
        catch (_: Exception) { Result.failure() }
    }
}
