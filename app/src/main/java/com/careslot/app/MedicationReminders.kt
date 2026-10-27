package com.careslot.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.work.*
import org.json.JSONArray
import org.json.JSONObject
import java.time.*
import java.util.concurrent.TimeUnit

object MedicationReminders {
    private fun prefs(c: Context) = c.getSharedPreferences("medication_reminder_work", Context.MODE_PRIVATE)
    private fun tag(user: String, plan: String) = "care-medication-$user-$plan"
    private fun next(plan: JSONObject, now: Instant): Instant? {
        val zone = ZoneId.of(plan.getString("timezone")); val first = LocalDate.parse(plan.getString("startDate")); val last = LocalDate.parse(plan.getString("endDate"))
        val today = now.atZone(zone).toLocalDate(); var day = if (today < first) first else today
        while (day <= last) {
            val times = plan.getJSONArray("times")
            val candidate = (0 until times.length()).map { day.atTime(LocalTime.parse(times.getString(it))).atZone(zone).toInstant() }.filter { it > now }.minOrNull()
            if (candidate != null) return candidate
            day = day.plusDays(1)
        }
        return null
    }
    fun reconcile(c: Context, user: String, plans: JSONArray) = synchronized(SessionVault.lock) {
        if (SessionVault(c).read()?.userId != user) return@synchronized
        val scheduled = mutableSetOf<String>(); val known = mutableSetOf<String>(); val work = WorkManager.getInstance(c); val notifications = c.getSystemService(NotificationManager::class.java)
        for (i in 0 until plans.length()) {
            val plan = plans.getJSONObject(i); val id = plan.getString("id"); known.add(id)
            if (!plan.getBoolean("enabled") || !plan.getBoolean("available")) { notifications.cancel(tag(user, id), 1); continue }
            val due = next(plan, Instant.now().plusSeconds(1)) ?: continue
            val name = "${tag(user, id)}-${plan.getInt("version")}-${due.toEpochMilli()}"; scheduled.add(name)
            val request = OneTimeWorkRequestBuilder<MedicationReminderWorker>().setInitialDelay((due.toEpochMilli() - System.currentTimeMillis()).coerceAtLeast(1000), TimeUnit.MILLISECONDS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).setInputData(workDataOf("userId" to user, "planId" to id, "version" to plan.getInt("version"), "scheduledAt" to due.toEpochMilli())).addTag(tag(user, id)).addTag("care-medication-$user").build()
            work.enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)
        }
        for (old in prefs(c).getStringSet("scheduled-$user", emptySet())!!.toSet() - scheduled) work.cancelUniqueWork(old)
        for (old in prefs(c).getStringSet("known-$user", emptySet())!!.toSet() - known) notifications.cancel(tag(user, old), 1)
        prefs(c).edit().putStringSet("scheduled-$user", scheduled).putStringSet("known-$user", known).commit()
    }
    fun clear(c: Context, user: String) {
        WorkManager.getInstance(c).cancelAllWorkByTag("care-medication-$user")
        val manager = c.getSystemService(NotificationManager::class.java)
        for (id in prefs(c).getStringSet("known-$user", emptySet())!!.toSet()) manager.cancel(tag(user, id), 1)
        prefs(c).edit().remove("known-$user").remove("scheduled-$user").commit()
    }
    fun show(c: Context, user: String, planId: String, test: Boolean) = synchronized(SessionVault.lock) {
        if (SessionVault(c).read()?.userId != user || !ConnectedReminders.permitted(c)) return@synchronized
        val manager = c.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("care-medication", "Medication reminders", NotificationManager.IMPORTANCE_DEFAULT))
        val intent = Intent(c, ExperienceActivity::class.java).putExtra("section", "medication").putExtra("reminderUserId", user).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(c, tag(user, planId).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(tag(user, planId), 1, Notification.Builder(c, "care-medication").setSmallIcon(R.drawable.ic_launcher).setContentTitle(if (test) "CareSlot test medication reminder" else "Medication reminder").setContentText("Open CareSlot to review your confirmed reminder schedule.").setContentIntent(pending).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build())
    }
    fun test(c: Context, user: String, plan: JSONObject) {
        if (!BuildConfig.DEBUG) return
        val id = plan.getString("id")
        val request = OneTimeWorkRequestBuilder<MedicationReminderWorker>().setInitialDelay(10, TimeUnit.SECONDS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setInputData(workDataOf("userId" to user, "planId" to id, "version" to plan.getInt("version"), "test" to true)).addTag("care-medication-$user").build()
        WorkManager.getInstance(c).enqueue(request)
    }
}
class MedicationReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val repository = ConnectedRepository(applicationContext); val user = inputData.getString("userId") ?: return Result.success(); val id = inputData.getString("planId") ?: return Result.success()
        if (repository.vault.read()?.userId != user) return Result.success()
        return try {
            val plans = repository.medicationPlans(); val plan = (0 until plans.length()).map { plans.getJSONObject(it) }.find { it.getString("id") == id }
            val test = inputData.getBoolean("test", false)
            if (plan != null && plan.getBoolean("available") && plan.getBoolean("enabled") && plan.getInt("version") == inputData.getInt("version", -1) && (test || System.currentTimeMillis() - inputData.getLong("scheduledAt", 0) <= 2 * 3600000L)) MedicationReminders.show(applicationContext, user, id, test)
            MedicationReminders.reconcile(applicationContext, user, plans); Result.success()
        } catch (_: java.io.IOException) { Result.retry() }
        catch (e: ClinicApiException) { if (e.status >= 500 || e.status == 429) Result.retry() else Result.failure() }
        catch (_: Exception) { Result.failure() }
    }
}
