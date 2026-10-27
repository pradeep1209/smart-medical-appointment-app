package com.careslot.app

import java.time.LocalDateTime
import java.time.ZoneId

/** The same booking-time definition feeds the time grid, saved visit and model. */
object ReminderPolicy {
    fun shouldScheduleMain(visit: VisitRecord, due: Long, hasPending: Boolean, allowed: Boolean,
        now: Long = System.currentTimeMillis()) = visit.status=="Booked" && visit.reminder && allowed &&
        due+86400000>now && (due>now || hasPending)

    fun planned(requested: Boolean, allowed: Boolean, date: String, time: String,
        now: LocalDateTime = LocalDateTime.now()): Boolean = requested && allowed && runCatching {
        val zone=ZoneId.systemDefault()
        LocalDateTime.parse("${date}T$time").atZone(zone).toInstant().minusSeconds(86400)
            .isAfter(now.atZone(zone).toInstant())
    }.getOrDefault(false)
}
