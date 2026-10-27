package com.careslot.app

import android.content.Context
import org.json.JSONArray
import java.time.*
import java.time.temporal.ChronoUnit
import java.util.UUID

interface ProfileRepository { fun addPatient(name: String): OperationResult }
interface AvailabilityRepository {
    fun updateDoctor(id: String, weekdays: String, start: String, end: String, duration: Int): OperationResult
    fun block(doctorId: String, date: String, start: String, end: String): OperationResult
}
interface AppointmentRepository {
    fun book(patientId: String, doctorId: String, date: String, time: String, reminder: Boolean): OperationResult
    fun reschedule(id: String, date: String, time: String, reminder: Boolean): OperationResult
    fun cancel(id: String): OperationResult
}
interface PrescriptionRepository {
    fun prescribe(visitId: String, medication: String, dose: String, frequency: String, duration: String, instructions: String): OperationResult
    fun requestRefill(planId: String, patientId: String): OperationResult
    fun reviewRefill(id: String, approved: Boolean, note: String): OperationResult
}

/** Construct and use on the ViewModel's serial worker, never the UI thread. */
class LocalClinicRepository(private val context: Context, val database: ClinicDatabase,
    private val predictor: AttendancePredictor?, private val modelVersion: String = predictor?.version ?: "unavailable") :
    ProfileRepository, AvailabilityRepository, AppointmentRepository, PrescriptionRepository {
    private val dao = database.clinic()
    private val prefs = context.getSharedPreferences("care_settings", Context.MODE_PRIVATE)
    private fun id() = UUID.randomUUID().toString()
    private fun stable(value: String) = UUID.nameUUIDFromBytes(value.toByteArray(Charsets.UTF_8)).toString()
    private fun fail(message: String) = OperationResult(false, message)
    private fun pass(message: String, id: String? = null) = OperationResult(true, message, id)
    fun snapshot() = ClinicSnapshot(dao.patients(), dao.doctors(), dao.visits(), dao.plans(), dao.refills(), dao.blocks(), dao.events())
    var overbooking: Boolean
        get() = prefs.getBoolean("overbooking", false) && predictor != null
        set(value) { prefs.edit().putBoolean("overbooking", value && predictor != null).apply() }

    fun importLegacy() = database.runInTransaction {
        if (dao.metadata("legacy_import_v1") != null) return@runInTransaction
        val old = context.getSharedPreferences("clinic_v1", Context.MODE_PRIVATE)
        val names = listOf("Dr. Meera Shah" to "General medicine", "Dr. Arjun Rao" to "Neurology", "Dr. Priya Menon" to "Gynecology")
        names.forEach { (name, specialty) -> dao.putDoctor(DoctorRecord(stable("doctor:$name"), name, specialty)) }
        fun patient(name: String): String {
            val clean = name.trim().ifEmpty { "Legacy patient" }
            val key = stable("legacy-patient:${clean.lowercase()}")
            dao.putPatient(PatientRecord(key, clean)); return key
        }
        fun doctor(name: String): String {
            val key = stable("doctor:$name")
            if (dao.doctors().none { it.id == key }) dao.putDoctor(DoctorRecord(key, name, "Imported doctor"))
            return key
        }
        val bookings = JSONArray(old.getString("appointments", "[]"))
        for (i in 0 until bookings.length()) {
            val a = bookings.getJSONObject(i)
            val status = a.getString("status")
            val record = VisitRecord(a.getString("id"), patient(a.getString("patient")), doctor(a.getString("doctor")), a.getString("date"), a.getString("time"),
                noShow = a.getDouble("noShow"), status = status, completedAt = if (status in listOf("Attended", "No-show")) System.currentTimeMillis() else 0,
                sharedSlot = a.optBoolean("sharedSlot"), modelVersion = "legacy-synthetic-v1")
            dao.putVisit(record); dao.putEvent(VisitEvent(stable("import:${record.id}"), record.id, "Imported existing appointment"))
        }
        val plans = JSONArray(old.getString("prescriptions", "[]"))
        for (i in 0 until plans.length()) {
            val p = plans.getJSONObject(i)
            val patientId = patient(p.getString("patient")); val doctorId = doctor(p.getString("doctor"))
            val key = stable("legacy-plan:$i:${p}")
            val visit = dao.visits().lastOrNull { it.patientId == patientId && it.doctorId == doctorId && it.status == "Attended" }
            dao.putPlan(PlanRecord(key, patientId, doctorId, visit?.id ?: "", "", "", "", "", p.getString("instructions"), p.getString("issued"), true))
            if (p.optBoolean("refillRequested")) dao.putRefill(RefillRecord(stable("legacy-refill:$key"), key))
        }
        if (dao.patients().isEmpty()) patient("Demo Patient")
        dao.putMetadata(MetadataRecord("legacy_import_v1", "complete"))
    }

    override fun addPatient(name: String): OperationResult {
        val clean = name.trim()
        if (clean.length !in 2..80) return fail("Enter a patient name with 2–80 characters.")
        if (dao.patients().any { it.name.equals(clean, true) }) return fail("That demo profile already exists. Choose it from the profile list.")
        val key = id(); dao.putPatient(PatientRecord(key, clean)); return pass("Patient profile created.", key)
    }

    override fun updateDoctor(id: String, weekdays: String, start: String, end: String, duration: Int): OperationResult {
        val doctor = dao.doctors().find { it.id == id } ?: return fail("Doctor not found.")
        val days = weekdays.split(",").mapNotNull { it.trim().toIntOrNull() }.distinct().sorted()
        val begin = runCatching { LocalTime.parse(start) }.getOrNull()
        val finish = runCatching { LocalTime.parse(end) }.getOrNull()
        if (days.isEmpty() || days.any { it !in 1..7 } || begin == null || finish == null || !finish.isAfter(begin) || duration !in listOf(15,20,30,45,60) || ChronoUnit.MINUTES.between(begin, finish) < duration)
            return fail("Choose working days, valid HH:mm hours, and a 15, 20, 30, 45 or 60 minute visit within those hours.")
        dao.putDoctor(doctor.copy(weekdays = days.joinToString(","), start = start, end = end, duration = duration))
        return pass("Availability saved. Existing visits are retained; review flagged conflicts.")
    }

    override fun block(doctorId: String, date: String, start: String, end: String): OperationResult {
        val day = runCatching { LocalDate.parse(date) }.getOrNull()
        val begin = runCatching { LocalTime.parse(start) }.getOrNull(); val finish = runCatching { LocalTime.parse(end) }.getOrNull()
        if (dao.doctors().none { it.id == doctorId } || day == null || day.isBefore(LocalDate.now()) || begin == null || finish == null || !finish.isAfter(begin))
            return fail("Enter a future date and a valid HH:mm blocked interval.")
        dao.putBlock(BlockRecord(id(), doctorId, date, start, end)); return pass("Blocked period saved. Existing appointments remain visible.")
    }
    fun removeBlock(id: String): OperationResult { dao.removeBlock(id); return pass("Blocked period removed.") }

    fun slots(doctorId: String, date: String): List<String> {
        val d = dao.doctors().find { it.id == doctorId } ?: return emptyList()
        val day = runCatching { LocalDate.parse(date) }.getOrNull() ?: return emptyList()
        if (day.dayOfWeek.value.toString() !in d.weekdays.split(",")) return emptyList()
        val result = mutableListOf<String>(); var t = LocalTime.parse(d.start); val end = LocalTime.parse(d.end)
        while (ChronoUnit.MINUTES.between(t, end) >= d.duration) {
            result += t.toString(); t = t.plusMinutes(d.duration.toLong())
        }
        return result
    }

    fun conflict(a: VisitRecord): Boolean {
        if (a.status != "Booked" || !LocalDateTime.parse("${a.date}T${a.time}").isAfter(LocalDateTime.now())) return false
        val doctor = dao.doctors().find { it.id == a.doctorId } ?: return true
        return a.time !in slots(a.doctorId, a.date) || a.duration != doctor.duration || blocked(a.doctorId, a.date, a.time, a.duration)
    }
    private fun overlap(time: String, duration: Int, otherTime: String, otherDuration: Int): Boolean {
        val a = LocalTime.parse(time); val b = LocalTime.parse(otherTime)
        return a.isBefore(b.plusMinutes(otherDuration.toLong())) && b.isBefore(a.plusMinutes(duration.toLong()))
    }
    private fun blocked(doctor: String, date: String, time: String, duration: Int) = dao.blocks().any {
        it.doctorId == doctor && it.date == date && overlap(time, duration, it.start, ChronoUnit.MINUTES.between(LocalTime.parse(it.start), LocalTime.parse(it.end)).toInt())
    }
    fun history(patientId: String, at: Long = System.currentTimeMillis()): List<VisitRecord> = dao.visits().filter {
        it.patientId == patientId && it.completedAt in 1..at && it.status in listOf("Attended", "No-show") &&
            LocalDateTime.parse("${it.date}T${it.time}").atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() <= at
    }.sortedByDescending { it.completedAt }.take(20)
    fun estimate(patientId: String, date: String, reminder: Boolean): Double? {
        val lead = ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(date)).toInt()
        if (lead !in 0..60) return null
        val records = history(patientId)
        return runCatching { predictor?.noShowProbability(BookingFeatures(lead, records.size, records.count { it.status == "No-show" }, reminder)) }.getOrNull()
    }

    fun slotError(patientId: String, doctorId: String, date: String, time: String, risk: Double?, exclude: String? = null): String? {
        if (dao.patients().none { it.id == patientId }) return "Choose a patient profile."
        val doctor = dao.doctors().find { it.id == doctorId } ?: return "Doctor not found."
        val start = runCatching { LocalDateTime.parse("${date}T${time}") }.getOrNull() ?: return "Choose a valid date and time."
        val lead = ChronoUnit.DAYS.between(LocalDate.now(), start.toLocalDate())
        if (lead !in 0..60 || !start.isAfter(LocalDateTime.now())) return "Choose a future appointment within 60 days."
        if (time !in slots(doctorId, date) || blocked(doctorId, date, time, doctor.duration)) return "That time is outside doctor availability or is blocked."
        val active = dao.visits().filter { it.id != exclude && it.date == date && it.status != "Cancelled" }
        if (active.any { it.patientId == patientId && overlap(time, doctor.duration, it.time, it.duration) }) return "This patient already has an overlapping visit."
        val occupied = active.filter { it.doctorId == doctorId && overlap(time, doctor.duration, it.time, it.duration) }
        if (occupied.isEmpty()) return null
        if (!overbooking || risk == null || occupied.any { it.noShow == null || it.status != "Booked" || it.time != time || it.duration != doctor.duration } || occupied.size >= 2)
            return "That time is already booked."
        if (occupied.sumOf { 1 - it.noShow!! } + (1-risk) > 1.2 + 1e-9) return "The shared slot exceeds the simulation attendance limit."
        return null
    }

    override fun book(patientId: String, doctorId: String, date: String, time: String, reminder: Boolean): OperationResult {
        var result = fail("Booking could not be saved.")
        database.runInTransaction {
            val risk = estimate(patientId, date, reminder)
            val error = slotError(patientId, doctorId, date, time, risk)
            if (error != null) { result = fail(error); return@runInTransaction }
            val duration = dao.doctors().first { it.id == doctorId }.duration
            val shared = dao.visits().any { it.doctorId == doctorId && it.date == date && it.time == time && it.status != "Cancelled" }
            val visit = VisitRecord(id(), patientId, doctorId, date, time, duration, risk, reminder = reminder, sharedSlot = shared, modelVersion = if (risk == null) "unavailable" else modelVersion)
            dao.putVisit(visit); dao.putEvent(VisitEvent(id(), visit.id, "Booked $date at $time"))
            result = pass("Appointment confirmed.", visit.id)
        }
        return result
    }

    override fun reschedule(id: String, date: String, time: String, reminder: Boolean): OperationResult {
        var result = fail("Rescheduling could not be saved.")
        database.runInTransaction {
            val visit = dao.visits().find { it.id == id } ?: run { result = fail("Visit not found."); return@runInTransaction }
            if (visit.status != "Booked") { result = fail("Only booked visits can be rescheduled."); return@runInTransaction }
            if (visit.date == date && visit.time == time) { result = fail("Choose a different appointment time."); return@runInTransaction }
            val risk = estimate(visit.patientId, date, reminder)
            val error = slotError(visit.patientId, visit.doctorId, date, time, risk, id)
            if (error != null) { result = fail(error); return@runInTransaction }
            val duration = dao.doctors().first { it.id == visit.doctorId }.duration
            val shared = dao.visits().any { it.id != id && it.doctorId == visit.doctorId && it.date == date && it.time == time && it.status != "Cancelled" }
            dao.putVisit(visit.copy(date = date, time = time, duration = duration, noShow = risk, reminder = reminder, sharedSlot = shared, modelVersion = if (risk == null) "unavailable" else modelVersion))
            dao.putEvent(VisitEvent(this.id(), id, "Rescheduled from ${visit.date} ${visit.time} to $date $time")); result = pass("Appointment rescheduled.", id)
        }
        return result
    }

    override fun cancel(id: String): OperationResult {
        val visit = dao.visits().find { it.id == id } ?: return fail("Visit not found.")
        if (visit.status != "Booked") return fail("Only booked visits can be cancelled.")
        database.runInTransaction { dao.putVisit(visit.copy(status = "Cancelled", reminder = false)); dao.putEvent(VisitEvent(this.id(), id, "Cancelled")) }
        return pass("Appointment cancelled.", id)
    }
    fun attendance(id: String, attended: Boolean): OperationResult {
        val visit = dao.visits().find { it.id == id } ?: return fail("Visit not found.")
        if (visit.status != "Booked" || LocalDateTime.parse("${visit.date}T${visit.time}").isAfter(LocalDateTime.now())) return fail("Attendance can only be recorded once, after the appointment starts.")
        val status = if (attended) "Attended" else "No-show"
        database.runInTransaction { dao.putVisit(visit.copy(status = status, completedAt = System.currentTimeMillis(), reminder = false)); dao.putEvent(VisitEvent(this.id(), id, status)) }
        return pass("Attendance recorded.", id)
    }
    fun sampleVisit(patientId: String): OperationResult {
        if (dao.patients().none { it.id == patientId }) return fail("Choose a patient.")
        val doctor = dao.doctors().first(); val key = id()
        dao.putVisit(VisitRecord(key, patientId, doctor.id, LocalDate.now().minusDays(1).toString(), "09:00", status = "Attended", completedAt = System.currentTimeMillis()))
        dao.putEvent(VisitEvent(id(), key, "Explicit fictional sample attended visit"))
        return pass("Sample attended visit added.", key)
    }

    override fun prescribe(visitId: String, medication: String, dose: String, frequency: String, duration: String, instructions: String): OperationResult {
        val visit = dao.visits().find { it.id == visitId } ?: return fail("Visit not found.")
        if (visit.status != "Attended") return fail("Choose an attended visit.")
        if (listOf(medication, dose, frequency, duration, instructions).any { it.isBlank() || it.length > 1000 }) return fail("Complete every prescription field (maximum 1,000 characters each).")
        val key = id(); dao.putPlan(PlanRecord(key, visit.patientId, visit.doctorId, visitId, medication.trim(), dose.trim(), frequency.trim(), duration.trim(), instructions.trim(), LocalDate.now().toString()))
        return pass("Prescription saved.", key)
    }
    fun carePlan(visitId: String, instructions: String): OperationResult {
        val visit=dao.visits().find{it.id==visitId&&it.status=="Attended"} ?: return fail("Choose an attended visit.")
        if(instructions.isBlank())return fail("Enter care instructions.")
        val key=id();dao.putPlan(PlanRecord(key,visit.patientId,visit.doctorId,visitId,"","","","",instructions.trim(),LocalDate.now().toString(),true))
        return pass("Care plan saved.",key)
    }
    override fun requestRefill(planId: String, patientId: String): OperationResult {
        var result = fail("Request could not be saved.")
        database.runInTransaction {
            val plan = dao.plans().find { it.id == planId && it.patientId == patientId }
            if (plan == null) { result = fail("Prescription not found for this patient."); return@runInTransaction }
            if (dao.refills().any { it.planId == planId && it.status == "Pending" }) { result = fail("A refill request is already pending."); return@runInTransaction }
            dao.putRefill(RefillRecord(id(), planId)); result = pass("Refill request sent for clinic review.")
        }
        return result
    }
    override fun reviewRefill(id: String, approved: Boolean, note: String): OperationResult {
        val request = dao.refills().find { it.id == id } ?: return fail("Request not found.")
        if (request.status != "Pending") return fail("This request was already reviewed.")
        if (note.isBlank()) return fail("Enter a review note.")
        dao.putRefill(request.copy(status = if (approved) "Approved" else "Rejected", note = note.trim(), reviewedAt = System.currentTimeMillis()))
        return pass("Refill decision saved. Medication is not dispensed by this demo.")
    }
}
