package com.careslot.app

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.graphics.Color
import android.view.View
import android.widget.*
import java.time.LocalDate
import java.time.LocalDateTime

class BookingFlow(private val host: MainActivity) {
    fun show(released:()->Unit)=with(host) {
        val vm=vm; val ui=ui
        val editing=data.visits.find{it.id==vm.draftVisit}
        val doctorId=editing?.doctorId ?: vm.draftDoctor.ifEmpty{data.doctors.first().id}
        vm.draftDoctor=doctorId
        val patient=editing?.patientId ?: vm.patientId
        val doctor=data.doctor(doctorId) ?: return@with
        val form=ui.column().apply{setPadding(ui.dp(20),ui.dp(8),ui.dp(20),ui.dp(16))}
        doctorSummary(form,doctorId);ui.rule(form)
        form.addView(ui.text("Patient: ${data.patient(patient)}",15f,bold=true))
        form.addView(ui.text("${doctor.duration} minute visit · In person",13f,CareTokens.muted))
        val date=ui.button(LocalDate.parse(vm.draftDate).format(dateLabel),1){}
        form.addView(date)
        val reminder=CheckBox(this).apply{text="Plan a reminder";isChecked=vm.draftReminder;minHeight=ui.dp(48);visibility=if(BuildConfig.ROADMAP_PHASE>=9)View.VISIBLE else View.GONE}
        form.addView(reminder)
        if(BuildConfig.ROADMAP_PHASE>=9)form.addView(ui.text(if(vm.notificationsAllowed())"About 24 hours before eligible visits; timing may vary." else "Notifications are off. You can still book this visit.",12f,CareTokens.muted))
        val grid=GridLayout(this).apply{columnCount=3};form.addView(grid)
        val summary=ui.text("Choose an available time.",14f,CareTokens.muted);form.addView(summary)
        val error=ui.text("",13f,CareTokens.danger);form.addView(error)
        var busy=false
        val dialog=AlertDialog.Builder(this).setTitle(if(editing==null)"Book a visit" else "Reschedule visit").setView(ScrollView(this).apply{addView(form)}).setNegativeButton("Back",null).create()
        val confirm=ui.button(if(editing==null)"Confirm appointment" else "Confirm new time") {
            if(!busy && vm.draftTime.isNotEmpty()) {
                busy=true
                val selectedTime=vm.draftTime;val selectedDate=vm.draftDate
                val planned=BuildConfig.ROADMAP_PHASE>=9 && ReminderPolicy.planned(reminder.isChecked,vm.notificationsAllowed(),selectedDate,selectedTime)
                action({repo->if(editing==null)repo.book(patient,doctorId,selectedDate,selectedTime,planned)else repo.reschedule(editing.id,selectedDate,selectedTime,planned)}) {r->
                    busy=false
                    if(r.ok){vm.clearDraft();dialog.dismiss();vm.filter="Upcoming";switchTab("Visits");message(r.message)}else error.text=r.message
                }
            }
        }.apply{isEnabled=false};form.addView(confirm)
        var generation=0
        fun reload() {
            val token=++generation;grid.removeAllViews();confirm.isEnabled=false;summary.text="Loading available times…"
            vm.availableSlots(patient,doctorId,vm.draftDate,BuildConfig.ROADMAP_PHASE>=9&&reminder.isChecked&&vm.notificationsAllowed(),editing?.id){slots,_->
                if(token!=generation || !dialog.isShowing)return@availableSlots
                val chips=mutableListOf<Button>()
                summary.text=if(slots.none{it.second})"No available times. Choose another date." else "Choose an available time."
                slots.forEach{(time,available)->
                    val chip=ui.button(time,1){}
                    chip.isEnabled=available
                    chip.layoutParams=GridLayout.LayoutParams().apply{width=0;height=ui.dp(52);columnSpec=GridLayout.spec(GridLayout.UNDEFINED,1f);setMargins(ui.dp(3),ui.dp(4),ui.dp(3),ui.dp(4))}
                    chip.setPadding(ui.dp(4),0,ui.dp(4),0)
                    chip.setOnClickListener{
                        vm.draftTime=time;chips.forEach{b->b.isSelected=false;b.background=ui.shape(if(b.isEnabled)CareTokens.sage else CareTokens.border,12,true);b.setTextColor(if(b.isEnabled)CareTokens.teal else CareTokens.muted)}
                        chip.isSelected=true;chip.background=ui.shape(CareTokens.teal,12);chip.setTextColor(Color.WHITE)
                        val shared=data.visits.any{it.id!=editing?.id&&it.doctorId==doctorId&&it.date==vm.draftDate&&it.time==time&&it.status!="Cancelled"}
                        summary.text="Review your visit\n${data.patient(patient)}\n${doctor.name}\n${vm.draftDate} at $time · ${doctor.duration} min${if(shared)"\nShared slot · simulation" else ""}"
                        confirm.isEnabled=true;error.text=""
                    }
                    chips+=chip;grid.addView(chip)
                    if(time==vm.draftTime && available)chip.post{chip.performClick()}
                }
            }
        }
        date.setOnClickListener{
            val day=LocalDate.parse(vm.draftDate)
            DatePickerDialog(this,{_,y,m,d->vm.draftDate=LocalDate.of(y,m+1,d).toString();vm.draftTime="";date.text=LocalDate.parse(vm.draftDate).format(dateLabel);reload()},day.year,day.monthValue-1,day.dayOfMonth).apply{
                datePicker.minDate=System.currentTimeMillis();datePicker.maxDate=java.util.Calendar.getInstance().apply{add(java.util.Calendar.DAY_OF_YEAR,60)}.timeInMillis
            }.show()
        }
        reminder.setOnCheckedChangeListener{_,value->vm.draftReminder=value;reload()}
        dialog.setOnDismissListener{generation++;if(!isChangingConfigurations)vm.clearDraft();released()}
        dialog.show();styleDialog(dialog);reload()
    }
}
