package com.careslot.app

import android.app.Activity
import android.app.Instrumentation
import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import android.os.Bundle
import androidx.room.Room
import org.json.JSONArray
import java.time.LocalDate
import java.time.ZoneId

/** Debug-only on-phone checks. Explicit seed modes add marked fictional records. */
class QaInstrumentation : Instrumentation() {
    private var phase=5
    private var seedPhase8=false
    private var reconcileId:String?=null
    private var qaScheduleId:String?=null
    private var qaDelaySeconds=60
    override fun onCreate(arguments: Bundle?) {
        phase=arguments?.getString("phase")?.toIntOrNull() ?: 5
        seedPhase8=arguments?.getString("qa_seed_phase8")=="true"
        reconcileId=arguments?.getString("qa_reconcile")
        qaScheduleId=arguments?.getString("qa_schedule")
        qaDelaySeconds=arguments?.getString("qa_delay_seconds")?.toIntOrNull() ?: 60
        start()
    }
    override fun onStart() {
        if(reconcileId!=null || qaScheduleId!=null) {
            val result=Bundle()
            val ok=runCatching {
                require(BuildConfig.DEBUG && BuildConfig.ROADMAP_PHASE>=9)
                val db=Room.databaseBuilder(targetContext,ClinicDatabase::class.java,"care-clinic.db").build()
                try {
                    val visit=db.clinic().visits().first{it.id==(reconcileId ?: qaScheduleId)}
                    require(db.clinic().patients().first{it.id==visit.patientId}.name.startsWith("QA"))
                    val scheduler=ReminderScheduler(targetContext)
                    val r=if(reconcileId!=null)scheduler.qaReconcile(db.clinic().visits(),visit.id) else scheduler.qa(visit,qaDelaySeconds)
                    require(r.ok){r.message}
                    // Instrumentation finish terminates this process; drain earlier apply writes first.
                    require(targetContext.getSharedPreferences("care_reminders", Context.MODE_PRIVATE).edit().commit())
                    result.putString("stream","\n${r.message}\nFailures: 0\n")
                } finally {db.close()}
            }.onFailure{result.putString("stream","\nFAIL QA reconciliation: ${it.message}\nFailures: 1\n")}.isSuccess
            finish(if(ok)Activity.RESULT_OK else Activity.RESULT_CANCELED,result)
            return
        }
        if(seedPhase8) {
            val result=Bundle()
            val ok=runCatching {
                require(BuildConfig.DEBUG && BuildConfig.ROADMAP_PHASE>=8)
                result.putString("stream", "\n${seedAttendanceFixtures()}\nFailures: 0\n")
            }.onFailure { result.putString("stream","\nFAIL QA_PHASE8_SEED: ${it.message}\nFailures: 1\n") }.isSuccess
            finish(if(ok)Activity.RESULT_OK else Activity.RESULT_CANCELED,result)
            return
        }
        val lines=mutableListOf<String>();var failures=0
        fun check(name:String,body:()->Unit){try{body();lines+="PASS $name"}catch(e:Throwable){failures++;lines+="FAIL $name: ${e.message}"}}
        val base=targetContext
        val fixture=object:ContextWrapper(base){override fun getSharedPreferences(name:String,mode:Int):SharedPreferences=base.getSharedPreferences("qa-fixture-$phase-$name",mode)}
        val db=Room.inMemoryDatabaseBuilder(base,ClinicDatabase::class.java).build()
        try {
            fixture.getSharedPreferences("clinic_v1",0).edit().clear().putString("appointments","""[{"id":"legacy-qa","patient":"QA Legacy","doctor":"Dr. Meera Shah","date":"2026-01-01","time":"09:00","noShow":0.25,"status":"Attended"}]""")
                .putString("prescriptions","""[{"patient":"QA Legacy","doctor":"Dr. Meera Shah","instructions":"QA retained legacy care","issued":"2026-01-01","refillRequested":true}]""").commit()
            fixture.getSharedPreferences("care_settings",0).edit().clear().commit()
            val real=LocalLogisticPredictor(base)
            val repo=LocalClinicRepository(fixture,db,real)
            check("Legacy migration is atomic, idempotent, and retains pending refill"){
                repo.importLegacy();val before=repo.snapshot();repo.importLegacy();val after=repo.snapshot()
                require(before==after);require(after.visits.single().id=="legacy-qa");require(after.plans.single().instructions=="QA retained legacy care");require(after.refills.single().status=="Pending")
            }
            val a=repo.snapshot().patients.first().id
            val b=repo.addPatient("QA Second").id!!
            val d=repo.snapshot().doctors.first().id
            val date=LocalDate.now().plusDays(1).toString()
            check("Profiles have stable IDs and duplicate display names are rejected"){
                require(a!=b);require(!repo.addPatient("QA Second").ok);require(repo.snapshot().plans.all{it.patientId==a})
            }
            var first=""
            check("Normal booking rejects occupied and overlapping slots"){
                val r=repo.book(a,d,date,"09:00",false);require(r.ok){r.message};first=r.id!!
                require(!repo.book(b,d,date,"09:00",false).ok)
                val other=repo.snapshot().doctors.first{it.id!=d}.id
                require(!repo.book(a,other,date,"09:00",false).ok)
            }
            if(phase>=7)check("Availability edits retain visits and flag conflicts"){
                require(repo.updateDoctor(d,"1,2,3,4,5,6,7","10:00","15:00",30).ok)
                require(repo.snapshot().visits.any{it.id==first});require(repo.conflict(repo.snapshot().visits.first{it.id==first}))
                require(repo.updateDoctor(d,"1,2,3,4,5,6,7","09:00","15:00",30).ok)
                require(repo.block(d,date,"10:00","11:00").ok);require(!repo.book(b,d,date,"10:00",false).ok)
                repo.snapshot().blocks.forEach{repo.removeBlock(it.id)}
                require(!repo.book(b,d,LocalDate.now().minusDays(1).toString(),"11:00",false).ok)
            }
            if(phase>=8)check("Failed reschedule preserves original; successful reschedule preserves identity/history"){
                val booked=repo.book(b,d,date,"09:30",false);require(booked.ok)
                val before=repo.snapshot().visits.first{it.id==first}
                require(!repo.reschedule(first,date,"09:30",false).ok);require(repo.snapshot().visits.first{it.id==first}==before)
                require(repo.reschedule(first,date,"10:00",false).ok);require(repo.snapshot().visits.first{it.id==first}.time=="10:00")
                require(repo.snapshot().events.any{it.visitId==first&&it.description.startsWith("Rescheduled")})
                require(repo.cancel(first).ok);require(repo.book(a,d,date,"10:00",false).ok)
                require(!repo.attendance(booked.id!!,true).ok)
            }
            if(phase>=9)check("Reminder eligibility agrees at the 24-hour boundary and with permission denial"){
                val now=java.time.LocalDateTime.of(2026,10,16,12,0)
                require(!ReminderPolicy.planned(true,true,"2026-10-17","12:00",now))
                require(ReminderPolicy.planned(true,true,"2026-10-17","12:01",now))
                require(!ReminderPolicy.planned(true,true,"2026-10-17","11:59",now))
                require(!ReminderPolicy.planned(true,false,"2026-10-18","12:00",now))
                require(!ReminderPolicy.planned(false,true,"2026-10-18","12:00",now))
                val pending=VisitRecord("reminder-fixture",a,d,date,"12:00",reminder=true)
                val epoch=100000000L
                require(ReminderPolicy.shouldScheduleMain(pending,epoch+1000,false,true,epoch))
                require(ReminderPolicy.shouldScheduleMain(pending,epoch-1000,true,true,epoch))
                require(!ReminderPolicy.shouldScheduleMain(pending,epoch-1000,false,true,epoch))
                require(!ReminderPolicy.shouldScheduleMain(pending,epoch-86400000,true,true,epoch))
                require(!ReminderPolicy.shouldScheduleMain(pending.copy(status="Cancelled"),epoch+1000,true,true,epoch))
            }
            if(phase>=10)check("Prescriptions and refill decisions enforce ownership and pending uniqueness"){
                val sample=repo.sampleVisit(a);require(sample.ok)
                require(!repo.prescribe(sample.id!!,"","QA","QA","QA","QA").ok)
                val prescription=repo.prescribe(sample.id,"QA fictional medicine","QA dose","QA schedule","QA duration","QA instructions");require(prescription.ok)
                require(!repo.requestRefill(prescription.id!!,b).ok)
                require(repo.requestRefill(prescription.id,a).ok);require(!repo.requestRefill(prescription.id,a).ok)
                val request=repo.snapshot().refills.first{it.planId==prescription.id}
                require(!repo.reviewRefill(request.id,true,"").ok);require(repo.reviewRefill(request.id,true,"QA approved").ok);require(!repo.reviewRefill(request.id,false,"Again").ok)
                require(repo.requestRefill(prescription.id,a).ok)
                val second=repo.snapshot().refills.first{it.planId==prescription.id&&it.status=="Pending"}
                require(repo.reviewRefill(second.id,false,"QA rejected").ok)
                require(repo.snapshot().refills.count{it.planId==prescription.id}==2)
            }
            if(phase>=11){
                check("Model metadata matches the adapter and invalid models are rejected"){
                    val json=base.assets.open("attendance_model.json").bufferedReader().use{it.readText()}
                    require(real.version==org.json.JSONObject(json).getString("version"))
                    val invalidScale=org.json.JSONObject(json).apply{getJSONArray("scale").put(0,0.0)}
                    require(runCatching{LocalLogisticPredictor(invalidScale)}.isFailure)
                    val wrongClass=org.json.JSONObject(json).apply{put("positive_class","attendance")}
                    require(runCatching{LocalLogisticPredictor(wrongClass)}.isFailure)
                    val wrongOrder=org.json.JSONObject(json).apply{getJSONArray("features").put(0,"reminder_planned")}
                    require(runCatching{LocalLogisticPredictor(wrongOrder)}.isFailure)
                }
                check("Embedded Kotlin model matches exported reference calculations"){
                    val refs=JSONArray(base.assets.open("reference_predictions.json").bufferedReader().use{it.readText()})
                    for(i in 0 until refs.length()){
                        val r=refs.getJSONObject(i);val actual=real.noShowProbability(BookingFeatures(r.getInt("leadDays"),r.getInt("priorAppointments"),r.getInt("priorMissed"),r.getBoolean("reminderPlanned")))
                        require(kotlin.math.abs(actual-r.getDouble("expectedNoShow"))<1e-10)
                    }
                }
                check("History uses the latest 20 known outcomes and excludes cancellations and unknown results"){
                    val patient=repo.addPatient("QA History Window").id!!
                    val knownAt=System.currentTimeMillis()
                    repeat(23){index->db.clinic().putVisit(VisitRecord("history-$index",patient,d,LocalDate.now().minusDays(index+1L).toString(),"09:00",
                        status=if(index%3==0)"No-show" else "Attended",completedAt=knownAt-index*1000L))}
                    db.clinic().putVisit(VisitRecord("history-cancelled",patient,d,LocalDate.now().minusDays(1).toString(),"11:00",status="Cancelled",completedAt=knownAt))
                    db.clinic().putVisit(VisitRecord("history-unknown",patient,d,LocalDate.now().minusDays(1).toString(),"12:00",status="Attended",completedAt=0))
                    db.clinic().putVisit(VisitRecord("history-future-time",patient,d,date,"12:00",status="Attended",completedAt=knownAt))
                    db.clinic().putVisit(VisitRecord("history-future-recording",patient,d,LocalDate.now().minusDays(1).toString(),"13:00",status="No-show",completedAt=knownAt+1000))
                    require(repo.history(patient,knownAt).map{it.id}==(0 until 20).map{"history-$it"})
                    require(repo.history(patient,knownAt-5000).map{it.id}==(5 until 23).map{"history-$it"})
                }
                check("History excludes future or unknown outcomes; missing model keeps standard booking"){
                    val now=System.currentTimeMillis();val future=VisitRecord("future-outcome",a,d,date,"14:00",status="No-show",completedAt=now+100000)
                    db.clinic().putVisit(future);require(repo.history(a).none{it.id==future.id})
                    val unavailable=LocalClinicRepository(fixture,db,null);unavailable.overbooking=true;require(!unavailable.overbooking)
                    val newPatient=unavailable.addPatient("QA Model Fallback").id!!
                    val result=unavailable.book(newPatient,d,date,"13:00",false);require(result.ok){result.message};require(unavailable.snapshot().visits.first{it.id==result.id}.noShow==null)
                }
            }
            if(phase>=12)check("Overbooking threshold and two-patient cap are enforced at boundary"){
                val boundaryDate=LocalDate.now().plusDays(2).toString()
                val calibrated=object:AttendancePredictor{override fun noShowProbability(features:BookingFeatures)=0.4}
                val sim=LocalClinicRepository(fixture,db,calibrated);sim.overbooking=true
                val p1=sim.addPatient("QA Boundary One").id!!;val p2=sim.addPatient("QA Boundary Two").id!!;val p3=sim.addPatient("QA Boundary Three").id!!
                val r1=sim.book(p1,d,boundaryDate,"12:00",false);require(r1.ok){r1.message};require(sim.book(p2,d,boundaryDate,"12:00",false).ok){"Exact attendance boundary rejected"};require(!sim.book(p3,d,boundaryDate,"12:00",false).ok){"Third patient accepted"}
                require(sim.cancel(r1.id!!).ok);require(sim.book(p3,d,boundaryDate,"12:00",false).ok){"Cancellation did not release shared capacity"}
                val above=LocalClinicRepository(fixture,db,object:AttendancePredictor{override fun noShowProbability(features:BookingFeatures)=0.3999});above.overbooking=true
                require(above.book(p1,d,boundaryDate,"14:30",false).ok);require(!above.book(p2,d,boundaryDate,"14:30",false).ok){"Above-limit attendance accepted"}
                sim.overbooking=false;require(!sim.book(p1,d,boundaryDate,"12:00",false).ok){"Shared booking accepted while disabled"}
            }
        }catch(e:Throwable){failures++;lines+="FAIL harness: ${e.stackTraceToString()}"}finally{db.close()}
        val result=Bundle().apply{putString("stream",lines.joinToString("\n",prefix="\n",postfix="\nFailures: $failures\n"));putInt("failures",failures)}
        finish(if(failures==0)Activity.RESULT_OK else Activity.RESULT_CANCELED,result)
    }

    /** Adds only marked fictional records so the real clinic UI can record both outcomes. */
    private fun seedAttendanceFixtures(): String {
        val db=Room.databaseBuilder(targetContext,ClinicDatabase::class.java,"care-clinic.db").build()
        try {
            var ids=""
            db.runInTransaction {
                val dao=db.clinic()
                val doctor=dao.doctors().first()
                val patient=dao.patients().find{it.name=="QA Phase Eight"}
                    ?: PatientRecord(java.util.UUID.randomUUID().toString(),"QA Phase Eight").also(dao::putPatient)
                val date=LocalDate.now().minusDays(1).toString()
                val previous=dao.metadata("qa_phase8_attendance_seed")?.split("|")
                val visits=dao.visits()
                val prior=previous?.drop(1)?.mapNotNull{id->visits.find{it.id==id}}
                val pair=if(previous?.firstOrNull()==patient.id && prior!=null && prior.size==2 && prior.all{it.patientId==patient.id&&it.date==date&&it.status=="Booked"}) prior else {
                    listOf("09:00","10:00").map{time->
                        VisitRecord(java.util.UUID.randomUUID().toString(),patient.id,doctor.id,date,time,duration=doctor.duration).also{
                            dao.putVisit(it)
                            dao.putEvent(VisitEvent(java.util.UUID.randomUUID().toString(),it.id,"QA Phase 8 attendance fixture"))
                        }
                    }.also{dao.putMetadata(MetadataRecord("qa_phase8_attendance_seed",(listOf(patient.id)+it.map{v->v.id}).joinToString("|")))}
                }
                ids=pair.joinToString(","){it.id}
            }
            return "PASS QA_PHASE8_SEED patient=QA Phase Eight visitIds=$ids"
        } finally {db.close()}
    }
}
