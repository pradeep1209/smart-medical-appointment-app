package com.careslot.app

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.room.Room
import java.time.*

class ReminderScheduler(private val context: Context) {
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val prefs = context.getSharedPreferences("care_reminders", Context.MODE_PRIVATE)
    private val notifications = context.getSystemService(NotificationManager::class.java)
    init { notifications.createNotificationChannel(NotificationChannel("visits", "Appointment reminders", NotificationManager.IMPORTANCE_DEFAULT)) }
    fun allowed() = (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && notifications.areNotificationsEnabled()
    private fun pending(id: String, qa: Boolean, due: Long = 0, version: String = "") = PendingIntent.getBroadcast(context, 0,
        Intent(context, ReminderReceiver::class.java).setAction("com.careslot.app.reminder.${if(qa) "qa" else "main"}.$id")
            .setData(Uri.parse("careslot://reminder/${if (qa) "qa" else "main"}/$id")).putExtra("visit_id", id).putExtra("qa", qa)
            .putExtra("scheduled_due",due).putExtra("scheduled_version",version),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun fingerprint(v: VisitRecord) = "${v.date}T${v.time}:${v.status}"
    fun sync(visits: List<VisitRecord>) {
        val valid = visits.associateBy { it.id }
        prefs.all.keys.filter { it.startsWith("main:") || it.startsWith("qa:") }.forEach { key ->
            val id = key.substringAfter(":"); val visit = valid[id]
            if (visit == null || visit.status != "Booked" || prefs.getString("fingerprint:$id", "") != fingerprint(visit)) {
                alarms.cancel(pending(id, key.startsWith("qa:"))); prefs.edit().remove(key).apply()
                notifications.cancel(id.hashCode())
            }
        }
        for (visit in visits) {
            val previous=prefs.getString("fingerprint:${visit.id}",null)
            if(visit.status!="Booked" || (previous!=null && previous!=fingerprint(visit))) notifications.cancel(visit.id.hashCode())
            val due = LocalDateTime.parse("${visit.date}T${visit.time}").atZone(ZoneId.systemDefault()).toInstant().minusSeconds(86400).toEpochMilli()
            val key = "main:${visit.id}"
            val now=System.currentTimeMillis()
            // Retain a delayed pending reminder until the visit starts. A delivered
            // reminder has no key, so reopening the app cannot post it repeatedly.
            if (ReminderPolicy.shouldScheduleMain(visit,due,prefs.contains(key),allowed(),now)) {
                // OS alarms disappear at reboot while preferences survive. Re-arming the
                // same PendingIntent replaces it safely even when the stored due is unchanged.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, maxOf(due,now), pending(visit.id, false,due,fingerprint(visit)))
                prefs.edit().putLong(key, due).putString("fingerprint:${visit.id}", fingerprint(visit)).apply()
            } else { alarms.cancel(pending(visit.id, false)); prefs.edit().remove(key).apply() }
        }
    }
    fun qa(visit: VisitRecord, delaySeconds: Int = 10): OperationResult {
        if (!BuildConfig.DEBUG || visit.status != "Booked") return OperationResult(false, "Choose a booked visit in the debug app.")
        if(delaySeconds !in 5..120)return OperationResult(false,"QA delay must be 5–120 seconds.")
        if (!allowed()) return OperationResult(false, "Enable notifications first.")
        val due = System.currentTimeMillis() + delaySeconds*1000L
        prefs.edit().putLong("qa:${visit.id}", due).putString("fingerprint:${visit.id}", fingerprint(visit)).apply()
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pending(visit.id, true,due,fingerprint(visit)))
        return OperationResult(true, "QA reminder scheduled in approximately $delaySeconds seconds. Android may delay delivery.")
    }
    internal fun qaReconcile(visits: List<VisitRecord>, id: String): OperationResult {
        if(!BuildConfig.DEBUG)return OperationResult(false,"Debug app required.")
        val visit=visits.find{it.id==id} ?: return OperationResult(false,"Visit not found.")
        val due=prefs.getLong("main:$id",0)
        if(visit.status!="Booked" || !visit.reminder || due<=System.currentTimeMillis() || !allowed())
            return OperationResult(false,"Choose an eligible visit with a pending reminder.")
        alarms.cancel(pending(id,false))
        check(prefs.getLong("main:$id",0)==due)
        sync(visits)
        check(prefs.getLong("main:$id",0)==due)
        return OperationResult(true,"PASS QA reminder reconstruction $id due=$due")
    }
    fun deliver(visit: VisitRecord, qa: Boolean, scheduledDue: Long, scheduledVersion: String?) {
        val key = "${if (qa) "qa" else "main"}:${visit.id}"
        if (!allowed() || visit.status != "Booked" || scheduledDue<=0 || prefs.getLong(key,0)!=scheduledDue ||
            System.currentTimeMillis()<scheduledDue || scheduledVersion!=fingerprint(visit) || prefs.getString("fingerprint:${visit.id}", "") != fingerprint(visit)) return
        prefs.edit().remove(key).apply()
        val open = PendingIntent.getActivity(context, visit.id.hashCode(), Intent(context, MainActivity::class.java)
            .setData(Uri.parse("careslot://visit/${visit.id}")).putExtra("visit_id", visit.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        notifications.notify(visit.id.hashCode(), Notification.Builder(context, "visits").setSmallIcon(com.careslot.app.R.drawable.ic_care)
            .setContentTitle(if (qa) "CareSlot QA reminder" else "Appointment reminder")
            .setContentText("Your visit is ${visit.date} at ${visit.time}. Tap for details.").setContentIntent(open).setAutoCancel(true).build())
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        Thread {
            var db: ClinicDatabase? = null
            try {
                db = Room.databaseBuilder(context, ClinicDatabase::class.java, "care-clinic.db").build()
                val scheduler = ReminderScheduler(context)
                if (intent.action in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_MY_PACKAGE_REPLACED)) scheduler.sync(db.clinic().visits())
                else db.clinic().visits().find { it.id == intent.getStringExtra("visit_id") }?.let {
                    scheduler.deliver(it,intent.getBooleanExtra("qa",false),intent.getLongExtra("scheduled_due",0),intent.getStringExtra("scheduled_version"))
                }
            } catch(e:Exception) {
                android.util.Log.e("CareSlotReminders","Reminder processing failed; records retained",e)
            } finally { db?.close(); pending.finish() }
        }.start()
    }
}
