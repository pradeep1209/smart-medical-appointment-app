package com.careslot.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsetsController
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    internal val vm: ClinicViewModel by viewModels()
    internal val ui by lazy { UiKit(this) }
    internal var state = ClinicUiState()
    internal lateinit var content: LinearLayout
    private var scroll: ScrollView? = null
    private var scrollPosition = 0
    internal val dateLabel = DateTimeFormatter.ofPattern("EEE, dd MMM yyyy", Locale.getDefault())
    internal val data get() = state.data
    internal val forms by lazy { ClinicForms(this) }
    private var activeBooking: BookingFlow? = null
    private var activeVisit: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = CareTokens.canvas; window.navigationBarColor = Color.WHITE
        scrollPosition = savedInstanceState?.getInt("scrollY") ?: 0
        vm.state.observe(this) { next ->
            if(!state.loading) scrollPosition = scroll?.scrollY ?: scrollPosition
            state = next; render()
            if (!next.loading && next.error == null) {
                val deep = intent.getStringExtra("visit_id")
                if (deep != null) {
                    intent.removeExtra("visit_id")
                    val previousVisit = activeVisit
                    activeVisit = null
                    previousVisit?.dismiss()
                    data.visits.find { it.id == deep }?.let {
                        vm.patientId = it.patientId; vm.clinicMode = false; vm.tab = "Visits"
                        render(); showVisit(it)
                    }
                }
                else if (vm.bookingOpen && activeBooking == null) bookDialog()
                else if(vm.selectedVisit.isNotEmpty() && activeVisit==null) data.visits.find{it.id==vm.selectedVisit}?.let{showVisit(it)}
            }
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); vm.load() }
    override fun onSaveInstanceState(out: Bundle) { out.putInt("scrollY", scroll?.scrollY ?: 0); super.onSaveInstanceState(out) }
    internal fun message(value: String) = Toast.makeText(this,value,Toast.LENGTH_LONG).show()
    internal fun switchTab(name: String) { scrollPosition=0; vm.tab=name; render() }
    internal fun action(block: (LocalClinicRepository)->OperationResult, done: ((OperationResult)->Unit)?=null) {
        vm.perform(block) { result -> if (done != null) done(result) else message(result.message) }
    }
    internal fun card(tint: Int=Color.WHITE, body: LinearLayout.()->Unit)=ui.card(content,tint,body)
    internal fun heading(title: String, subtitle: String)=ui.heading(content,title,subtitle)
    internal fun section(title: String) { ui.gap(content,12); content.addView(ui.text(title,19f,CareTokens.ink,true)); ui.gap(content,8) }
    internal fun empty(title: String, description: String) { card { addView(ui.icon("calendar",size=28)); ui.gap(this); addView(ui.text(title,18f,bold=true)); addView(ui.text(description,14f,CareTokens.muted)) } }
    internal fun doctorSummary(parent: LinearLayout, id: String) {
        val doctor=data.doctor(id)
        parent.addView(ui.row().apply {
            addView(ui.text(doctor?.name?.removePrefix("Dr. ")?.split(" ")?.take(2)?.joinToString("") { it.take(1) } ?: "DR",17f,CareTokens.teal,true).apply {
                gravity=Gravity.CENTER; background=ui.shape(CareTokens.sage,16)
                importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
            },LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)).apply { marginEnd=ui.dp(12) })
            addView(ui.column().apply {
                addView(ui.text(doctor?.name ?: "Care team",17f,bold=true)); addView(ui.text(doctor?.specialty ?: "",13f,CareTokens.muted))
            },LinearLayout.LayoutParams(0,-2,1f))
        })
    }
    internal fun styleDialog(dialog: AlertDialog) {
        dialog.window?.setBackgroundDrawable(ui.shape(CareTokens.canvas,24))
        dialog.window?.setLayout(minOf(resources.displayMetrics.widthPixels-ui.dp(24),ui.dp(560)),-2)
        listOf(AlertDialog.BUTTON_POSITIVE,AlertDialog.BUTTON_NEGATIVE).forEach { dialog.getButton(it)?.apply { isAllCaps=false; setTextColor(CareTokens.teal); minHeight=ui.dp(48) } }
    }
    internal fun confirm(title: String, description: String, label: String, action: ()->Unit) {
        val dialog=AlertDialog.Builder(this).setTitle(title).setMessage(description).setNegativeButton("Back",null).setPositiveButton(label) { _,_->action() }.show(); styleDialog(dialog)
    }
    internal fun bookDialog(doctor: String?=null, visit: VisitRecord?=null) {
        if (state.loading || state.error != null) return
        if (doctor != null || visit != null) {
            vm.draftDoctor=doctor ?: visit!!.doctorId; vm.draftVisit=visit?.id ?: ""; vm.draftDate=visit?.date ?: LocalDate.now().plusDays(1).toString(); vm.draftTime=""
        }
        vm.bookingOpen=true
        activeBooking=BookingFlow(this).also { it.show { activeBooking=null } }
    }
    internal fun showVisit(v: VisitRecord) {
        if(activeVisit!=null)return
        vm.selectedVisit=v.id
        val form=ui.column().apply { setPadding(ui.dp(24),ui.dp(8),ui.dp(24),ui.dp(12)) }
        doctorSummary(form,v.doctorId); ui.rule(form)
        form.addView(ui.text("${v.date} at ${v.time}",20f,bold=true)); form.addView(ui.text("${data.patient(v.patientId)} · ${v.duration} minutes · ${v.status}",14f,CareTokens.muted))
        if (state.conflicts.contains(v.id)) form.addView(ui.text("Availability changed. This visit needs clinic review.",14f,CareTokens.danger))
        if (BuildConfig.ROADMAP_PHASE >= 9) form.addView(ui.text(if (!v.reminder) "Reminder off" else if (!vm.notificationsAllowed()) "Reminders unavailable: notifications are not enabled." else "Reminder planned about 24 hours before the visit when eligible.",13f,CareTokens.muted))
        if (vm.clinicMode && BuildConfig.ROADMAP_PHASE >= 11) form.addView(ui.text("No-show estimate: ${v.noShow?.let { "%.4f".format(Locale.US,it) } ?: "unavailable"}\nModel: ${v.modelVersion}",13f,CareTokens.muted))
        val dialog=AlertDialog.Builder(this).setTitle("Appointment details").setView(ScrollView(this).apply { addView(form) }).setNegativeButton("Close",null).create()
        if (v.status=="Booked") {
            if(BuildConfig.ROADMAP_PHASE>=8) form.addView(ui.button("Reschedule visit",1) { dialog.dismiss(); bookDialog(visit=v) })
            form.addView(ui.button("Cancel appointment",2) { confirm("Cancel this visit?","${v.date} at ${v.time}","Cancel visit") { action({ it.cancel(v.id) }); dialog.dismiss() } })
            if(vm.clinicMode && !LocalDateTime.parse("${v.date}T${v.time}").isAfter(LocalDateTime.now())) {
                form.addView(ui.button("Record attended") { action({it.attendance(v.id,true)});dialog.dismiss() })
                form.addView(ui.button("Record no-show",1) { action({it.attendance(v.id,false)});dialog.dismiss() })
            }
            if(BuildConfig.DEBUG && BuildConfig.ROADMAP_PHASE>=9 && vm.clinicMode) form.addView(ui.button("QA reminder in 10 seconds",1) { vm.qaReminder(v) {message(it.message)} })
        }
        val events=data.events.filter {it.visitId==v.id}
        if(events.isNotEmpty()) { ui.rule(form); form.addView(ui.text("Visit history",17f,bold=true)); events.forEach {form.addView(ui.text(it.description,13f,CareTokens.muted))} }
        dialog.setOnDismissListener {
            if (activeVisit === dialog) {
                activeVisit = null
                if (!isChangingConfigurations) vm.selectedVisit = ""
            }
        }
        activeVisit=dialog
        dialog.show();styleDialog(dialog)
    }
    internal fun requestNotifications() {
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),101)
        else message(if(vm.notificationsAllowed()) "Notifications are enabled." else "Enable CareSlot notifications in your phone's app settings.")
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, results: IntArray) { super.onRequestPermissionsResult(requestCode,permissions,results); if(requestCode==101) {message(if(vm.notificationsAllowed()) "Notifications enabled." else "Notifications are off. Booking still works.");vm.load()} }

    internal fun render() {
        val root=ui.column().apply {setBackgroundColor(CareTokens.canvas)}
        val brand=ui.row().apply {setPadding(ui.dp(24),ui.dp(10),ui.dp(24),ui.dp(8))}
        brand.addView(ui.text("+  CareSlot",21f,CareTokens.ink,true),LinearLayout.LayoutParams(0,-2,1f))
        brand.addView(ui.badge("OFFLINE DEMO"));root.addView(brand)
        if(BuildConfig.ROADMAP_PHASE>=6 && data.patients.isNotEmpty()) root.addView(ui.button(if(vm.clinicMode) "Clinic demo · Switch profile" else "${data.patient(vm.patientId)} · Switch profile",2) {forms.profiles()}.apply {layoutParams=LinearLayout.LayoutParams(-1,-2).apply {marginStart=ui.dp(16);marginEnd=ui.dp(16)}})
        content=ui.column().apply {setPadding(ui.dp(24),ui.dp(12),ui.dp(24),ui.dp(24))}
        val frame=FrameLayout(this).apply {addView(content,FrameLayout.LayoutParams(if(resources.configuration.screenWidthDp>650)ui.dp(600) else -1,-2,Gravity.TOP or Gravity.CENTER_HORIZONTAL))}
        scroll=ScrollView(this).apply {isFillViewport=true;addView(frame)}
        root.addView(scroll,LinearLayout.LayoutParams(-1,0,1f))
        val nav=ui.row().apply {setBackgroundColor(Color.WHITE);setPadding(ui.dp(8),ui.dp(8),ui.dp(8),ui.dp(8))}
        val tabs=if(BuildConfig.ROADMAP_PHASE>=6 && vm.clinicMode) listOf("Clinic" to "clinic","Visits" to "calendar","Plans" to "plan") else listOf("Home" to "home","Visits" to "calendar","Plans" to "plan")+(if(BuildConfig.ROADMAP_PHASE<6) listOf("Clinic" to "clinic") else emptyList())
        if(tabs.none {it.first==vm.tab}) vm.tab=tabs.first().first
        for((name,symbol) in tabs) nav.addView(ui.column().apply {
            val active=name==vm.tab;gravity=Gravity.CENTER;isClickable=true;isFocusable=true;isSelected=active
            contentDescription="$name${if(active) ", selected" else ""}";background=ui.shape(if(active)CareTokens.sage else Color.WHITE,12)
            addView(ui.icon(symbol,if(active)CareTokens.teal else CareTokens.muted));addView(ui.text(name,12f,if(active)CareTokens.teal else CareTokens.muted,active).apply{gravity=Gravity.CENTER});setOnClickListener{switchTab(name)}
        },LinearLayout.LayoutParams(0,ui.dp(60),1f))
        root.addView(nav);setContentView(root)
        when {
            state.loading -> {content.addView(ProgressBar(this));content.addView(ui.text("Loading local records…"))}
            state.error!=null -> {empty("Records need attention",state.error!!);content.addView(ui.button("Retry"){vm.load()})}
            else -> ClinicScreens(this).render(vm.tab)
        }
        scroll?.post {scroll?.scrollTo(0,scrollPosition)}
    }
}

