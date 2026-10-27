package com.careslot.app

import android.app.ActivityOptions
import android.app.Notification
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.UUID

/** Opens an actual, already delivered QA notification's PendingIntent on the test phone. */
class QaNotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        resultCode = 1
        resultData = "No matching delivered QA notification"
        if (!BuildConfig.DEBUG) return
        val id = intent.getStringExtra("visit_id") ?: return
        if (runCatching { UUID.fromString(id) }.isFailure) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val delivered = manager.activeNotifications.firstOrNull {
            it.id == id.hashCode() &&
                it.notification.extras.getString(Notification.EXTRA_TITLE) == "CareSlot QA reminder"
        } ?: return
        try {
            val options = ActivityOptions.makeBasic()
            if (Build.VERSION.SDK_INT >= 34) {
                options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
            }
            delivered.notification.contentIntent.send(context, 0, null, null, null, null, options.toBundle())
            manager.cancel(delivered.id)
            resultCode = 0
            resultData = "Opened delivered QA notification"
        } catch (e: Exception) {
            resultData = "QA notification open failed: ${e.javaClass.simpleName}"
        }
    }
}
