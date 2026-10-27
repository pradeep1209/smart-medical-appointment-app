package com.careslot.app

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.widget.*
import java.time.LocalDate
import org.json.JSONObject

class ClinicForms(private val host: MainActivity) {
    private val ui get()=host.ui
    private fun form()=ui.column().apply{setPadding(ui.dp(24),ui.dp(8),ui.dp(24),ui.dp(12))}
    private fun edit(title:String,body:LinearLayout,save:(AlertDialog,TextView)->Unit) {
        val error=ui.text("",13f,CareTokens.danger);body.addView(error)
        val d=AlertDialog.Builder(host).setTitle(title).setView(ScrollView(host).apply{addView(body)}).setNegativeButton("Back",null).setPositiveButton("Save",null).create()
        d.setOnShowListener{d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{save(d,error)}}
        d.show();host.styleDialog(d)
    }
    private fun submit(d:AlertDialog,error:TextView,action:(LocalClinicRepository)->OperationResult,done:((OperationResult)->Unit)?=null) {
        d.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled=false
        host.action(action){r->
            d.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled=true
            if(r.ok){d.dismiss();done?.invoke(r);host.message(r.message)}else error.text=r.message
        }
    }
    fun profiles()=with(host) {
        val choices=data.patients.map{it.name}+listOf("Clinic demo","Add fictional patient")
        val d=AlertDialog.Builder(this).setTitle("Choose a demo profile").setItems(choices.toTypedArray()){_,index->
            when {
                index<data.patients.size->{vm.patientId=data.patients[index].id;vm.clinicMode=false;switchTab("Home")}
                index==data.patients.size->{vm.clinicMode=true;switchTab("Clinic")}
                else->{val form=form();form.addView(ui.text("Use fictional details. Profiles demonstrate workflows; they are not authenticated accounts.",13f,CareTokens.muted));val name=ui.input(form,"Patient name");edit("New demo patient",form){dialog,error->submit(dialog,error,{it.addPatient(name.text.toString())}){r->vm.patientId=r.id!!;vm.clinicMode=false;switchTab("Home")}}}
            }
        }.setNegativeButton("Back",null).show();styleDialog(d)
    }
    fun availability(d:DoctorRecord)=with(host) {
        val form=form();form.addView(ui.text("Existing visits are retained. Schedule changes can flag conflicts for review.",13f,CareTokens.muted))
        val labels=listOf("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")
        val checks=labels.mapIndexed{index,label->CheckBox(this).apply{text=label;isChecked=(index+1).toString() in d.weekdays.split(",");minHeight=ui.dp(48);form.addView(this)}}
        val start=ui.input(form,"Start time (HH:mm)",d.start);val end=ui.input(form,"End time (HH:mm)",d.end)
        form.addView(ui.text("Consultation duration",13f,CareTokens.muted))
        val durations=listOf(15,20,30,45,60)
        val length=Spinner(this).apply{adapter=ArrayAdapter(this@with,android.R.layout.simple_spinner_dropdown_item,durations.map{"$it minutes"});setSelection(durations.indexOf(d.duration).coerceAtLeast(0));minimumHeight=ui.dp(52)};form.addView(length)
        edit("${d.name} · Availability",form){dialog,error->submit(dialog,error,{it.updateDoctor(d.id,checks.mapIndexedNotNull{index,c->if(c.isChecked)(index+1).toString()else null}.joinToString(","),start.text.toString().trim(),end.text.toString().trim(),durations[length.selectedItemPosition])})}
    }
    fun block(d:DoctorRecord)=with(host) {
        val form=form();var date=LocalDate.now().plusDays(1)
        val day=ui.button(date.format(dateLabel),1){}
        day.setOnClickListener{DatePickerDialog(this,{_,y,m,dd->date=LocalDate.of(y,m+1,dd);day.text=date.format(dateLabel)},date.year,date.monthValue-1,date.dayOfMonth).apply{datePicker.minDate=System.currentTimeMillis()}.show()};form.addView(day)
        val start=ui.input(form,"Blocked from (HH:mm)",d.start);val end=ui.input(form,"Blocked until (HH:mm)",d.end)
        edit("Block a period",form){dialog,error->submit(dialog,error,{it.block(d.id,date.toString(),start.text.toString().trim(),end.text.toString().trim())})}
    }
    fun sample()=with(host) {
        val d=AlertDialog.Builder(this).setTitle("Add fictional attended visit for…").setItems(data.patients.map{it.name}.toTypedArray()){_,index->action({it.sampleVisit(data.patients[index].id)})}.setNegativeButton("Back",null).show();styleDialog(d)
    }
    fun prescription()=with(host) {
        val attended=data.visits.filter{it.status=="Attended"}
        if(attended.isEmpty()){message("Add or record an attended visit first.");return@with}
        val form=form();form.addView(ui.text("Clinician-entered demonstration only. Use fictional medication details.",13f,CareTokens.muted))
        val visits=Spinner(this).apply{adapter=ArrayAdapter(this@with,android.R.layout.simple_spinner_dropdown_item,attended.map{"${data.patient(it.patientId)} · ${it.date}"});minimumHeight=ui.dp(52)};form.addView(visits)
        val structured=BuildConfig.ROADMAP_PHASE>=10
        val medication=if(structured)ui.input(form,"Medication name") else null
        val dose=if(structured)ui.input(form,"Dose (clinician entered)") else null
        val frequency=if(structured)ui.input(form,"Frequency") else null
        val duration=if(structured)ui.input(form,"Duration") else null
        val instructions=ui.input(form,"Care instructions").apply{setSingleLine(false);minLines=3}
        edit(if(structured)"Issue prescription" else "Add care plan",form){dialog,error->
            submit(dialog,error,{repo->if(structured)repo.prescribe(attended[visits.selectedItemPosition].id,medication!!.text.toString(),dose!!.text.toString(),frequency!!.text.toString(),duration!!.text.toString(),instructions.text.toString())else repo.carePlan(attended[visits.selectedItemPosition].id,instructions.text.toString())})
        }
    }
    fun review(r:RefillRecord)=with(host) {
        val form=form();form.addView(ui.text("Record a demonstration review decision. Approval does not dispense medication.",13f,CareTokens.muted))
        val decision=Spinner(this).apply{adapter=ArrayAdapter(this@with,android.R.layout.simple_spinner_dropdown_item,listOf("Approve","Reject"));minimumHeight=ui.dp(52)};form.addView(decision)
        val note=ui.input(form,"Review note").apply{setSingleLine(false);minLines=2}
        edit("Review refill request",form){dialog,error->submit(dialog,error,{it.reviewRefill(r.id,decision.selectedItemPosition==0,note.text.toString())})}
    }
    fun evaluation()=with(host) {
        val results=JSONObject(assets.open("evaluation.json").bufferedReader().use{it.readText()})
        val logistic=results.getJSONObject("logistic");val baseline=results.getJSONObject("constant_baseline")
        val policies=results.getJSONObject("simulation").getJSONObject("policies")
        val text=buildString {
            append("Synthetic demonstration only\n\nIndependent generated records: ${results.getInt("rows")}\n")
            append("Model AUC: %.3f\nModel Brier: %.3f\nBaseline Brier: %.3f\n\n".format(java.util.Locale.US,logistic.getDouble("auc"),logistic.getDouble("brier"),baseline.getDouble("brier")))
            listOf("standard","prediction_assisted").forEach{name->val p=policies.getJSONObject(name);append(name.replace('_',' ') + "\n");append("Attended: %.2f\nWait: %.2f min\nOvertime: %.2f min\nCollision slots: %.2f\n\n".format(java.util.Locale.US,p.getDouble("attended"),p.getDouble("mean_wait_minutes"),p.getDouble("overtime_minutes"),p.getDouble("collision_slots")))}
            append("500 paired sessions; 18 candidates; 12 half-hour slots; synthetic independent attendance; 20–40 min service. Increased attendance can increase waiting. These are not clinic measurements.")
        }
        val form=form().apply{addView(ui.text(text))}
        val d=AlertDialog.Builder(this).setTitle("Synthetic evaluation").setView(ScrollView(this).apply{addView(form)}).setNegativeButton("Close",null).show();styleDialog(d)
    }
}
