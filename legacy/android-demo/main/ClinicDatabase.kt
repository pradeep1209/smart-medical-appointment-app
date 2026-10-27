package com.careslot.app

import androidx.room.*

@Entity(tableName = "patients")
data class PatientRecord(@PrimaryKey val id: String, val name: String)
@Entity(tableName = "doctors")
data class DoctorRecord(@PrimaryKey val id: String, val name: String, val specialty: String, val duration: Int = 30,
    val weekdays: String = "1,2,3,4,5,6,7", val start: String = "09:00", val end: String = "15:00")
@Entity(tableName = "appointments", indices = [Index("patientId"), Index(value = ["doctorId", "date"])])
data class VisitRecord(@PrimaryKey val id: String, val patientId: String, val doctorId: String,
    val date: String, val time: String, val duration: Int = 30, val noShow: Double? = null,
    val status: String = "Booked", val createdAt: Long = System.currentTimeMillis(), val completedAt: Long = 0,
    val reminder: Boolean = false, val sharedSlot: Boolean = false, val modelVersion: String = "unavailable")
@Entity(tableName = "prescriptions", indices = [Index("patientId"), Index("visitId")])
data class PlanRecord(@PrimaryKey val id: String, val patientId: String, val doctorId: String, val visitId: String,
    val medication: String, val dose: String, val frequency: String, val duration: String,
    val instructions: String, val issued: String, val legacy: Boolean = false)
@Entity(tableName = "refill_requests", indices = [Index("planId")])
data class RefillRecord(@PrimaryKey val id: String, val planId: String, val status: String = "Pending",
    val note: String = "", val createdAt: Long = System.currentTimeMillis(), val reviewedAt: Long = 0)
@Entity(tableName = "blocked_periods", indices = [Index("doctorId")])
data class BlockRecord(@PrimaryKey val id: String, val doctorId: String, val date: String, val start: String, val end: String)
@Entity(tableName = "appointment_events", indices = [Index("visitId")])
data class VisitEvent(@PrimaryKey val id: String, val visitId: String, val description: String, val timestamp: Long = System.currentTimeMillis())
@Entity(tableName = "metadata")
data class MetadataRecord(@PrimaryKey val key: String, val value: String)

@Dao
interface ClinicDao {
    @Query("SELECT * FROM patients ORDER BY name") fun patients(): List<PatientRecord>
    @Query("SELECT * FROM doctors ORDER BY name") fun doctors(): List<DoctorRecord>
    @Query("SELECT * FROM appointments ORDER BY date, time") fun visits(): List<VisitRecord>
    @Query("SELECT * FROM prescriptions ORDER BY issued DESC") fun plans(): List<PlanRecord>
    @Query("SELECT * FROM refill_requests ORDER BY createdAt DESC") fun refills(): List<RefillRecord>
    @Query("SELECT * FROM blocked_periods ORDER BY date, start") fun blocks(): List<BlockRecord>
    @Query("SELECT * FROM appointment_events ORDER BY timestamp DESC") fun events(): List<VisitEvent>
    @Query("SELECT value FROM metadata WHERE `key` = :key") fun metadata(key: String): String?
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putPatient(record: PatientRecord)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putDoctor(record: DoctorRecord)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putVisit(record: VisitRecord)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putPlan(record: PlanRecord)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putRefill(record: RefillRecord)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putBlock(record: BlockRecord)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putEvent(record: VisitEvent)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun putMetadata(record: MetadataRecord)
    @Query("DELETE FROM blocked_periods WHERE id = :id") fun removeBlock(id: String)
}

@Database(entities = [PatientRecord::class, DoctorRecord::class, VisitRecord::class, PlanRecord::class,
    RefillRecord::class, BlockRecord::class, VisitEvent::class, MetadataRecord::class], version = 1, exportSchema = true)
abstract class ClinicDatabase : RoomDatabase() { abstract fun clinic(): ClinicDao }

data class ClinicSnapshot(val patients: List<PatientRecord> = emptyList(), val doctors: List<DoctorRecord> = emptyList(),
    val visits: List<VisitRecord> = emptyList(), val plans: List<PlanRecord> = emptyList(),
    val refills: List<RefillRecord> = emptyList(), val blocks: List<BlockRecord> = emptyList(), val events: List<VisitEvent> = emptyList()) {
    fun patient(id: String) = patients.find { it.id == id }?.name ?: "Legacy patient"
    fun doctor(id: String) = doctors.find { it.id == id }
}
data class OperationResult(val ok: Boolean, val message: String, val id: String? = null)
