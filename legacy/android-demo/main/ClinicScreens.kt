package com.careslot.app

import android.graphics.Color
import android.widget.*
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.Locale

class ClinicScreens(private val host: MainActivity) {
    fun render(tab: String) = with(host) {
        when(tab) { "Home"->home(); "Visits"->visits(); "Plans"->plans(); else->clinic() }
    }
    private fun home() = with(host) {
        heading("Care that fits your day.","Plan your next visit with confidence.")
        content.addView(ui.button("Book an appointment") { bookDialog(data.doctors.firstOrNull()?.id) })
        section("Your next visit")
        val next=data.visits.filter {it.patientId==vm.patientId && it.status=="Booked" && LocalDateTime.parse("${it.date}T${it.time}").isAfter(LocalDateTime.now())}.minByOrNull {it.date+it.time}
        if(next==null) empty("Your calendar has room","Choose a doctor and book a visit.") else visit(next)
        section("Your care team")
        data.doctors.forEach { d -> card {
            doctorSummary(this,d.id);ui.rule(this)
            addView(ui.text("${d.start}–${d.end} · ${d.duration} minute visits",13f,CareTokens.muted))
            addView(ui.button("Choose a time",1) {bookDialog(d.id)})
        } }
        if(BuildConfig.ROADMAP_PHASE>=9) {
            section("Reminders")
            card { addView(ui.text(if(vm.notificationsAllowed()) "Notifications enabled" else "Notifications are off",17f,bold=true));addView(ui.text("Reminders are scheduled approximately 24 hours before eligible visits. Android may delay delivery.",13f,CareTokens.muted));addView(ui.button("Notification permission",1){requestNotifications()}) }
        }
    }
    private fun visits() = with(host) {
        heading("Your visits",if(vm.clinicMode) "Clinic appointments across all demo patients." else "All the details for your next appointment.")
        content.addView(ui.row().apply {
            listOf("Upcoming","Past").forEach { filter -> addView(ui.button(filter,if(vm.filter==filter)0 else 1){vm.filter=filter;switchTab("Visits")}.apply {layoutParams=LinearLayout.LayoutParams(0,-2,1f).apply{marginEnd=ui.dp(4)}}) }
        });ui.gap(content,18)
        val list=data.visits.filter {vm.clinicMode || it.patientId==vm.patientId}.filter {
            val future=it.status=="Booked" && LocalDateTime.parse("${it.date}T${it.time}").isAfter(LocalDateTime.now())
            if(vm.filter=="Upcoming")future else !future
        }.sortedBy{it.date+it.time}.let{if(vm.filter=="Past")it.reversed() else it}
        if(list.isEmpty())empty("No ${vm.filter.lowercase()} visits",if(vm.filter=="Upcoming")"Your confirmed appointments will appear here." else "Completed, missed, and cancelled visits appear here.")
        list.forEach {visit(it)}
        if(!vm.clinicMode) content.addView(ui.button("Book a new visit"){bookDialog(data.doctors.firstOrNull()?.id)})
    }
    private fun visit(v: VisitRecord) = with(host) {
        card {
            addView(ui.badge(if(v.status=="Booked") "Confirmed" else v.status))
            ui.gap(this);doctorSummary(this,v.doctorId);ui.rule(this)
            addView(ui.text("${LocalDate.parse(v.date).format(dateLabel)} · ${v.time}",15f,bold=true))
            addView(ui.text("${data.patient(v.patientId)} · ${v.duration} min · In person",13f,CareTokens.muted))
            if(data.visits.count{it.doctorId==v.doctorId&&it.date==v.date&&it.time==v.time&&it.status!="Cancelled"}>1 && v.status!="Cancelled")addView(ui.badge("Shared slot · simulation"))
            if(state.conflicts.contains(v.id))addView(ui.text("Availability conflict · Clinic review needed",13f,CareTokens.danger,true))
            if(vm.clinicMode && BuildConfig.ROADMAP_PHASE>=11) addView(ui.text("Attendance estimate: ${v.noShow?.let{"${((1-it)*100).toInt()}%"} ?: "unavailable"} · synthetic model",13f,CareTokens.muted))
            addView(ui.button("View appointment",1){showVisit(v)})
        }
    }
    private fun plans() = with(host) {
        heading("Your care plans",if(vm.clinicMode) "Prescriptions and instructions across demo patients." else "Your instructions and next steps.")
        val plans=data.plans.filter{vm.clinicMode||it.patientId==vm.patientId}
        if(plans.isEmpty())empty("Care continues here","After an attended visit, the clinic can add your prescription or care instructions.")
        plans.forEach {p->card {
            addView(ui.badge(if(p.legacy)"Care instructions" else "Prescription"));ui.gap(this)
            addView(ui.text(if(p.legacy)data.patient(p.patientId) else p.medication,20f,bold=true))
            addView(ui.text("${data.patient(p.patientId)} · ${data.doctor(p.doctorId)?.name}\nIssued ${p.issued}",13f,CareTokens.muted))
            ui.rule(this)
            if(!p.legacy)addView(ui.text("Dose: ${p.dose}\nFrequency: ${p.frequency}\nDuration: ${p.duration}",15f))
            addView(ui.text(p.instructions))
            val requests=data.refills.filter{it.planId==p.id}
            requests.forEach{r->
                ui.rule(this);addView(ui.badge("Refill: ${r.status}"));if(r.note.isNotBlank())addView(ui.text(r.note,14f,CareTokens.muted))
                if(vm.clinicMode && r.status=="Pending")addView(ui.button("Review refill",1){forms.review(r)})
            }
            if(!vm.clinicMode) addView(ui.button(if(requests.any{it.status=="Pending"})"Awaiting clinic review" else "Request refill",1){action({it.requestRefill(p.id,vm.patientId)})}.apply{isEnabled=requests.none{it.status=="Pending"}})
            addView(ui.text("Refills require clinician review. This demo does not dispense medication.",12f,CareTokens.muted))
        }}
    }
    private fun clinic() = with(host) {
        heading("Clinic workspace","A clear view of visits and follow-up care.")
        val booked=data.visits.count{it.status=="Booked"};val pending=data.refills.count{it.status=="Pending"}
        card(CareTokens.sage) {
            addView(ui.text("$booked booked · $pending refill ${if(pending==1)"request" else "requests"}",20f,bold=true))
            addView(ui.text("${state.conflicts.size} availability conflicts to review",13f,CareTokens.muted))
        }
        if(BuildConfig.ROADMAP_PHASE>=7) {
            section("Doctor availability")
            data.doctors.forEach{d->card{
                val days=d.weekdays.split(",").mapNotNull{it.toIntOrNull()}.map{java.time.DayOfWeek.of(it).getDisplayName(java.time.format.TextStyle.SHORT,Locale.getDefault())}.joinToString(", ")
                doctorSummary(this,d.id);addView(ui.text("${d.start}–${d.end} · ${d.duration} min\nWorking days: $days",13f,CareTokens.muted))
                addView(ui.button("Edit availability",1){forms.availability(d)})
                addView(ui.button("Block a period",2){forms.block(d)})
                data.blocks.filter{it.doctorId==d.id}.forEach{b->addView(ui.text("${b.date} · ${b.start}–${b.end}",13f));addView(ui.button("Remove block",2){action({it.removeBlock(b.id)})})}
            }}
        }
        section("Care plans")
        content.addView(ui.button("Issue prescription"){forms.prescription()})
        content.addView(ui.button("Add sample attended visit",1){forms.sample()})
        data.refills.filter{it.status=="Pending"}.forEach{r->
            val p=data.plans.find{it.id==r.planId}
            card {addView(ui.text("Refill review · ${p?.let{data.patient(it.patientId)} ?: "Unknown"}",17f,bold=true));addView(ui.text(p?.medication?.ifEmpty{"Imported care plan"} ?: ""));addView(ui.button("Review refill",1){forms.review(r)})}
        }
        if(BuildConfig.ROADMAP_PHASE>=11) {
            section("Attendance model")
            card {
                addView(ui.badge(if(state.modelAvailable)"Model available" else "Model unavailable"))
                addView(ui.text("Embedded logistic regression · synthetic training data. Up to the latest 20 completed outcomes known at booking are used.",13f,CareTokens.muted))
                data.patients.forEach{p->val h=data.visits.filter{it.patientId==p.id&&it.status in listOf("Attended","No-show")&&it.completedAt>0};addView(ui.text("${p.name}: ${h.size} recorded outcomes",13f))}
                if(BuildConfig.DEBUG)addView(ui.button(if(state.modelAvailable)"QA: simulate missing model" else "QA: restore model",1){vm.forceModelFailure(state.modelAvailable)})
            }
        }
        if(BuildConfig.ROADMAP_PHASE>=12) {
            section("Scheduling simulation")
            card {
                addView(Switch(host).apply{text="Enable demo overbooking";isChecked=state.overbooking;isEnabled=state.modelAvailable;setOnCheckedChangeListener{_,value->action({it.overbooking=value;OperationResult(true,"Simulation ${if(value)"enabled" else "disabled"}.")})}})
                addView(ui.text("At most 2 patients per slot; combined expected attendance ≤1.2. This is a heuristic, not a clinical capacity guarantee.",13f,CareTokens.muted))
                addView(ui.button("View synthetic evaluation",1){forms.evaluation()})
            }
        }
        section("Appointment queue")
        if(data.visits.isEmpty())empty("Ready for your first visit","Patient bookings appear here.")
        data.visits.sortedWith(compareBy<VisitRecord>{it.status!="Booked"}.thenBy{it.date+it.time}).forEach{visit(it)}
        content.addView(ui.text("Local demonstration workspace. Profiles do not provide production authentication.",12f,CareTokens.muted))
    }
}
