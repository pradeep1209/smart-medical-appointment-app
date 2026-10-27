package com.careslot.app

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log

/** Removes only the retired demo's reminder jobs; clinical records and connected sessions stay intact. */
object RetireOfflineDemo {
    fun run(context: Context) {
        val upgrade = context.getSharedPreferences("care_upgrades", Context.MODE_PRIVATE)
        if (upgrade.getBoolean("offline_demo_retired_v1", false)) return
        runCatching {
            val oldReminders = context.getSharedPreferences("care_reminders", Context.MODE_PRIVATE)
            val alarms = context.getSystemService(AlarmManager::class.java)
            oldReminders.all.keys.filter { it.startsWith("main:") || it.startsWith("qa:") }.forEach { key ->
                val kind = key.substringBefore(':')
                val id = key.substringAfter(':')
                val intent = Intent().setClassName(context.packageName, "com.careslot.app.ReminderReceiver")
                    .setAction("com.careslot.app.reminder.$kind.$id")
                    .setData(Uri.parse("careslot://reminder/$kind/$id"))
                PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let {
                    alarms.cancel(it)
                    it.cancel()
                }
            }
            // Channel IDs are scoped to this app; this channel belonged only to the demo.
            context.getSystemService(NotificationManager::class.java).deleteNotificationChannel("visits")
            check(oldReminders.edit().clear().commit())
            check(upgrade.edit().putBoolean("offline_demo_retired_v1", true).commit())
        }.onFailure { Log.w("CareSlotUpgrade", "Retired reminder cleanup will retry on the next launch.") }
    }
}
