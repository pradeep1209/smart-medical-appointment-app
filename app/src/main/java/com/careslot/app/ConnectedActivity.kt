package com.careslot.app

import android.app.AlertDialog
import android.app.DatePickerDialog
import android.graphics.Color
import android.content.res.ColorStateList
import android.graphics.drawable.RippleDrawable
import android.os.Bundle
import android.text.InputType
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class ConnectedActivity : ComponentActivity() {
    private val vm: ConnectedViewModel by viewModels()
    private val ui by lazy { UiKit(this) }
    private var warning: AlertDialog? = null
    private val clinicConnectionResult = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result -> if (result.resultCode == RESULT_OK) vm.load() }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed -> vm.reminders(allowed) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        RetireOfflineDemo.run(this)
        window.statusBarColor = CareTokens.canvas
        window.navigationBarColor = Color.WHITE
        onBackPressedDispatcher.addCallback(this) {
            val current = vm.state.value
            when {
                current?.selectedDoctor != null && current.rescheduling != null -> vm.showVisits()
                current?.selectedDoctor != null || current?.accountScreen == true || current?.visitsScreen == true || current?.careScreen == true -> vm.screen(false)
                else -> finish()
            }
        }
        vm.state.observe(this) { state ->
            render(state)
            handleDestination(state)
            handleFollowUp(state)
            if (state.session?.userId == intent.getStringExtra("reminderUserId") && intent.getBooleanExtra("openVisits", false)) { intent.removeExtra("openVisits"); vm.showVisits() }
            if (state.logoutWarning && warning == null) warning = AlertDialog.Builder(this)
                .setTitle("Sign out on this phone?")
                .setMessage("The clinic service could not be reached to revoke your server session. You can still remove the saved session and clinic information from this phone.")
                .setNegativeButton("Stay signed in") { _, _ -> vm.dismissLogoutWarning() }
                .setPositiveButton("Sign out here") { _, _ -> vm.signOut(true) }.create().also { dialog ->
                    dialog.setOnDismissListener { warning = null; if (vm.state.value?.logoutWarning == true) vm.dismissLogoutWarning() }
                    dialog.show()
                }
        }
    }
    override fun onResume() {
        super.onResume()
        val current = vm.state.value
        if (current?.session != null && !current.loading && !current.busy && !current.bookingBusy && !current.careBusy) vm.load()
    }
    override fun onNewIntent(value: android.content.Intent) {
        super.onNewIntent(value); intent = value
        vm.state.value?.let { handleDestination(it) }
        vm.state.value?.let { handleFollowUp(it) }
        if (vm.state.value?.session?.userId == value.getStringExtra("reminderUserId") && value.getBooleanExtra("openVisits", false)) { intent.removeExtra("openVisits"); vm.showVisits() }
    }
    private fun handleDestination(state: ConnectedState) {
        if (state.loading || state.session == null || !intent.hasExtra("navigationTab")) return
        val target = intent.getStringExtra("navigationTab")
        val expectedOwner = intent.getStringExtra("navigationUserId")
        intent.removeExtra("navigationTab")
        if (expectedOwner != null && expectedOwner != state.session.userId) return
        selectDestination(target ?: "clinic")
    }
    private fun selectDestination(target: String) {
        when (target) {
            "visits" -> vm.showVisits(vm.state.value?.visitsPast ?: false)
            "care" -> vm.showCare()
            "inbox" -> careTools("notifications")
            "account" -> vm.screen(true)
            else -> vm.screen(false)
        }
    }
    private fun handleFollowUp(state: ConnectedState) {
        if (!state.loading && state.session?.userId == intent.getStringExtra("followupUserId") && intent.hasExtra("followupDoctor")) {
            val doctor = intent.getStringExtra("followupDoctor") ?: return
            val date = intent.getStringExtra("followupDate")
            intent.removeExtra("followupDoctor")
            vm.availability(JSONObject(doctor), date)
        }
    }
    private fun careTools(section: String = "home", recordId: String? = null) {
        startActivity(android.content.Intent(this, ExperienceActivity::class.java).putExtra("section", section).putExtra("recordId", recordId))
    }

    private fun field(parent: LinearLayout, label: String, value: String, key: String, password: Boolean = false, email: Boolean = false, changed: (String) -> Unit): EditText {
        val input = ui.input(parent, label, value).apply {
            tag = key
            inputType = when {
                password -> InputType.TYPE_CLASS_TEXT or if (vm.passwordVisible) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD
                email -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                else -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            }
            typeface = ui.face()
            isSaveEnabled = false
            imeOptions = if (password) EditorInfo.IME_ACTION_DONE else EditorInfo.IME_ACTION_NEXT
            setAutofillHints(when { password -> View.AUTOFILL_HINT_PASSWORD; email -> View.AUTOFILL_HINT_USERNAME; else -> View.AUTOFILL_HINT_NAME })
            hint = when { email -> "you@example.com"; password -> "Enter your password"; else -> "Your full name" }
            setOnEditorActionListener { _, action, _ -> if (password && action == EditorInfo.IME_ACTION_DONE) { vm.submit(); true } else false }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { changed(s?.toString() ?: "") }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        if (password) {
            val parameters = input.layoutParams
            parent.removeView(input)
            val frame = FrameLayout(this)
            input.setPadding(ui.dp(14), ui.dp(14), ui.dp(82), ui.dp(14))
            frame.addView(input, FrameLayout.LayoutParams(-1, -2))
            val toggle = ui.text(if (vm.passwordVisible) "Hide" else "Show", 12f, CareTokens.ink, true).apply {
                gravity = Gravity.CENTER
                minHeight = ui.dp(54)
                isClickable = true; isFocusable = true
                isEnabled = vm.state.value?.busy != true
                contentDescription = if (vm.passwordVisible) "Hide password" else "Show password"
                background = RippleDrawable(ColorStateList.valueOf(CareTokens.sage), null, null)
                setOnClickListener {
                    val cursor = input.selectionStart.coerceAtLeast(0)
                    vm.passwordVisible = !vm.passwordVisible
                    input.inputType = InputType.TYPE_CLASS_TEXT or if (vm.passwordVisible) InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD else InputType.TYPE_TEXT_VARIATION_PASSWORD
                    input.typeface = ui.face()
                    input.setSelection(cursor.coerceAtMost(input.length()))
                    text = if (vm.passwordVisible) "Hide" else "Show"
                    contentDescription = if (vm.passwordVisible) "Hide password" else "Show password"
                }
            }
            frame.addView(toggle, FrameLayout.LayoutParams(ui.dp(72), ui.dp(54), Gravity.END or Gravity.CENTER_VERTICAL))
            parent.addView(frame, parameters)
        }
        return input
    }

    private fun render(state: ConnectedState) {
        val root = ui.column().apply { setBackgroundColor(CareTokens.canvas) }
        val header = ui.row().apply { setPadding(ui.dp(24), ui.dp(18), ui.dp(24), ui.dp(12)) }
        header.addView(ui.brand(), LinearLayout.LayoutParams(0, -2, 1f))
        if (state.session != null) {
            val user = JSONObject(state.session.userJson)
            header.addView(FrameLayout(this).apply {
                addView(ui.avatar(user.getString("displayName"), 36), FrameLayout.LayoutParams(ui.dp(36), ui.dp(36), Gravity.CENTER))
                isClickable = true; isFocusable = true; contentDescription = "My account"
                setOnClickListener { vm.screen(true) }
            }, LinearLayout.LayoutParams(ui.dp(48), ui.dp(48)))
        } else header.addView(ui.text("Patient app", 12f, CareTokens.muted))
        root.addView(header)
        val content = ui.column().apply { setPadding(ui.dp(24), ui.dp(20), ui.dp(24), ui.dp(24)) }
        val frame = FrameLayout(this).apply {
            addView(content, FrameLayout.LayoutParams(if (resources.configuration.screenWidthDp > 650) ui.dp(560) else -1, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
        }
        root.addView(ScrollView(this).apply { isFillViewport = true; addView(frame) }, LinearLayout.LayoutParams(-1, 0, 1f))
        when {
            state.loading -> { ui.gap(content, 48); content.addView(ProgressBar(this)); ui.gap(content, 16); content.addView(ui.text("Opening your care team…", 14f, CareTokens.muted).apply { gravity = Gravity.CENTER }) }
            state.session == null -> auth(content, state)
            state.selectedDoctor != null -> availability(content, state)
            state.visitsScreen -> visits(content, state)
            state.careScreen -> care(content, state)
            state.accountScreen -> account(content, state)
            else -> home(content, state)
        }
        if (state.session != null) root.addView(ui.patientNavigation(when { state.visitsScreen || state.rescheduling != null -> "visits"; state.careScreen -> "care"; state.accountScreen -> "account"; else -> "clinic" }) { selectDestination(it) })
        setContentView(root)
    }

    private fun auth(content: LinearLayout, state: ConnectedState) {
        ui.gap(content, 12)
        ui.heading(content, if (state.register) "Your care starts here." else "Your care, connected.", if (state.register) "Create your patient account and meet your clinic's care team." else "Sign in to see your clinic and care team.")
        content.addView(ui.row().apply {
            setPadding(ui.dp(4), ui.dp(4), ui.dp(4), ui.dp(4)); background = ui.shape(CareTokens.sage, 16)
            listOf("Sign in" to false, "Create account" to true).forEach { (label, register) ->
                addView(ui.button(label, if (state.register == register) 1 else 2) { vm.registration(register) }.apply {
                    isEnabled = !state.busy; isSelected = state.register == register
                    minimumHeight = ui.dp(44); minHeight = ui.dp(44); textSize = 13f
                }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(2); marginEnd = ui.dp(2) })
            }
        })
        ui.gap(content, 26)
        ui.card(content) {
            if (state.register) field(this, "Full name", vm.name, "name") { vm.name = it }.isEnabled = !state.busy
            field(this, "Email address", vm.email, "email", email = true) { vm.email = it }.isEnabled = !state.busy
            field(this, "Password", vm.password, "password", password = true) { vm.password = it }.isEnabled = !state.busy
            if (state.register) addView(ui.text("Use at least 12 characters.", 12f, CareTokens.muted))
            state.error?.let { addView(ui.text(it, 13f, CareTokens.danger).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) }
            state.accountNotice?.let { addView(ui.text(it, 13f, CareTokens.teal).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) }
            addView(ui.button(if (state.busy) "Please wait…" else if (state.register) "Create patient account" else "Sign in to CareSlot") { vm.submit() }.apply { isEnabled = !state.busy })
        }
        ui.gap(content, 6)
        content.addView(ui.text("Doctors and clinic staff use the clinic web workspace.", 12f, CareTokens.muted).apply { gravity = Gravity.CENTER })
        if (!state.register) content.addView(ui.button("Recover account", 2) { credentialsDialog("Recover account", recovery = true) }.apply { isEnabled = !state.busy })
        ClinicConnection(this).saved()?.let { content.addView(ui.text("Clinic server: ${it.name}", 12f, CareTokens.muted)) }
        content.addView(ui.button("Clinic connection", 2) { openClinicConnection() }.apply { isEnabled = !state.busy })
    }

    private fun openClinicConnection() { clinicConnectionResult.launch(android.content.Intent(this, ClinicConnectionActivity::class.java)) }

    private fun notice(content: LinearLayout, state: ConnectedState) {
        state.error?.let { message ->
            ui.card(content, if (state.offline) Color.rgb(249,246,235) else Color.rgb(255,245,241)) {
                addView(ui.text(if (state.offline) "Saved information" else "A connection needs attention", 14f, bold = true))
                addView(ui.text(message, 13f, if (state.offline) CareTokens.muted else CareTokens.danger))
            }
        }
    }

    private fun home(content: LinearLayout, state: ConnectedState) {
        val user = JSONObject(state.session!!.userJson)
        content.addView(ui.text("Hello, ${user.getString("displayName").substringBefore(' ')}", 14f, CareTokens.muted))
        ui.gap(content, 4)
        ui.heading(content, "Your care team", "A familiar place for your clinic and the people who care for you.")
        notice(content, state)
        val data = state.cached?.let { runCatching { JSONObject(it.payload) }.getOrNull() }
        val clinics = data?.optJSONArray("clinics")
        if (clinics == null) ui.card(content) {
            addView(ui.text("Let's connect your clinic", 18f, bold = true))
            addView(ui.text("Refresh when you're connected to load your care team.", 14f, CareTokens.muted))
        } else if (clinics.length() == 0) ui.card(content) {
            addView(ui.text("Your clinic connection", 18f, bold = true))
            addView(ui.text("Contact your clinic to connect your account.", 14f, CareTokens.muted))
        }
        if (clinics != null) for (index in 0 until clinics.length()) {
            val clinic = clinics.getJSONObject(index)
            val doctors = clinic.getJSONArray("doctors")
            content.addView(ui.row().apply {
                addView(ui.icon("clinic", CareTokens.muted, 22))
                addView(ui.column().apply {
                    addView(ui.text(clinic.getString("name"), 18f, bold = true))
                    addView(ui.text("${doctors.length()} ${if (doctors.length() == 1) "doctor" else "doctors"} in your care team", 12f, CareTokens.muted))
                }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(12) })
            })
            ui.gap(content, 18)
            if (doctors.length() == 0) ui.card(content) {
                addView(ui.text("Your care team is growing", 17f, bold = true))
                addView(ui.text("Doctors will appear here once they join your clinic.", 14f, CareTokens.muted))
            }
            for (doctorIndex in 0 until doctors.length()) {
                val doctor = doctors.getJSONObject(doctorIndex)
                val name = doctor.getString("name")
                val specialty = doctor.getString("specialty")
                val minutes = doctor.getInt("consultationMinutes")
                ui.card(content) {
                    addView(ui.row().apply {
                        addView(ui.avatar(name, 48))
                        addView(ui.column().apply { addView(ui.text(name, 17f, bold = true)); addView(ui.text(specialty, 13f, CareTokens.muted)) }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(14) })
                        addView(ui.icon("chevron", CareTokens.muted, 18))
                    })
                    ui.gap(this, 16)
                    addView(ui.row().apply {
                        addView(ui.icon("clock", CareTokens.muted, 16))
                        addView(ui.text("$minutes minute consultations", 12f, CareTokens.muted), LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(7) })
                        addView(ui.text("View profile", 12f, CareTokens.teal, true))
                    })
                    isClickable = true; isFocusable = true
                    contentDescription = "$name, $specialty. $minutes minute consultations. View profile."
                    background = RippleDrawable(ColorStateList.valueOf(CareTokens.sage), ui.shape(Color.WHITE, 18, true), null)
                    setOnClickListener {
                        AlertDialog.Builder(this@ConnectedActivity).setTitle(name).setMessage("$specialty\n\n${clinic.getString("name")}\n$minutes minute consultations")
                            .setNegativeButton("Close", null)
                            .setPositiveButton("Available times") { _, _ ->
                                vm.availability(JSONObject(doctor.toString()).put("clinicId", clinic.getString("id")).put("clinic", clinic.getString("name")).put("timezone", clinic.getString("timezone")))
                            }.show()
                    }
                }
            }
        }
        content.addView(ui.row().apply {
            addView(ui.text(state.cached?.let { "Updated ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it.savedAt))}" } ?: "Clinic details are waiting to load", 11f, CareTokens.muted), LinearLayout.LayoutParams(0, -2, 1f))
            addView(ui.button(if (state.busy) "Refreshing…" else "Refresh", 2) { vm.load() }.apply { isEnabled = !state.busy; textSize = 12f }, LinearLayout.LayoutParams(-2, -2))
        })
        ui.gap(content, 18)
        ui.card(content, CareTokens.sage) {
            addView(ui.text("Appointments", 17f, bold = true))
            addView(ui.text("Choose a doctor and an available time to confirm a visit. Your appointments appear in My visits.", 13f, CareTokens.muted))
            addView(ui.button("View my visits", 1) { vm.showVisits() })
        }
    }

    private fun account(content: LinearLayout, state: ConnectedState) {
        val user = JSONObject(state.session!!.userJson)
        ui.heading(content, "Your account", "Your patient identity and clinic connection.")
        content.addView(ui.button("Clinic connection", 1) { openClinicConnection() }.apply { isEnabled = !state.busy })
        ui.card(content) {
            addView(ui.row().apply {
                addView(ui.avatar(user.getString("displayName"), 56))
                addView(ui.column().apply { addView(ui.text(user.getString("displayName"), 19f, bold = true)); addView(ui.text("Patient account", 12f, CareTokens.muted)) }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(14) })
            })
            ui.rule(this)
            addView(ui.text("Email address", 12f, CareTokens.muted))
            addView(ui.text(user.getString("email"), 15f))
            val clinics = state.cached?.let { runCatching { JSONObject(it.payload).optJSONArray("clinics") }.getOrNull() }
            if (clinics != null && clinics.length() > 0) {
                ui.rule(this)
                addView(ui.text("Your clinic", 12f, CareTokens.muted))
                for (index in 0 until clinics.length()) addView(ui.text(clinics.getJSONObject(index).getString("name"), 15f))
            }
        }
        state.error?.let { content.addView(ui.text(it, 13f, CareTokens.danger)) }
        state.accountNotice?.let { content.addView(ui.text(it, 13f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) }
        content.addView(ui.button("Edit name", 1) {
            val box = ui.column().apply { setPadding(ui.dp(24), ui.dp(8), ui.dp(24), 0) }
            val input = ui.input(box, "Full name", user.getString("displayName")).apply { filters = arrayOf(android.text.InputFilter.LengthFilter(100)); isSaveEnabled = false }
            AlertDialog.Builder(this).setTitle("Edit your name").setView(box).setNegativeButton("Back", null).setPositiveButton("Save", null).create().apply {
                setOnShowListener { getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { if (input.text.toString().trim().length < 2) input.error = "Enter at least two characters." else { vm.saveProfile(input.text.toString()); dismiss() } } }; show()
            }
        }.apply { isEnabled = !state.busy })
        content.addView(ui.button("Change password", 1) { credentialsDialog("Change password") }.apply { isEnabled = !state.busy })
        content.addView(ui.button("Sign out other sessions", 2) { AlertDialog.Builder(this).setTitle("Sign out other sessions?").setMessage("This phone stays signed in. Your other app and dashboard sessions will end.").setNegativeButton("Back", null).setPositiveButton("Sign out others") { _, _ -> vm.revokeOtherSessions() }.show() }.apply { isEnabled = !state.busy })
        ui.card(content) {
            addView(ui.text("Records & reminders", 18f, bold = true))
            addView(ui.button("My health details", 1) { careTools("profile") })
            addView(ui.button("Export care history", 2) { careTools("export") })
            addView(ui.text("Saved visits and prescriptions are read-only when offline. Refresh to check for clinic updates before making changes.", 13f, CareTokens.muted))
            addView(ui.button("Sync records now", 1) { vm.syncNow() }.apply { isEnabled = !state.busy })
            val enabled = ConnectedReminders.enabled(this@ConnectedActivity, state.session.userId)
            addView(ui.text(if (enabled) "Appointment reminders are on" else "Appointment reminders are off", 14f, bold = true))
            if (enabled && !ConnectedReminders.permitted(this@ConnectedActivity)) addView(ui.text("Notifications are blocked in Android settings. Enable CareSlot notifications to receive reminders.", 13f, CareTokens.danger))
            if (!ConnectedReminders.permitted(this@ConnectedActivity)) addView(ui.button("Notification settings", 2) { startActivity(android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)) })
            addView(ui.text("Reminders are scheduled about 24 hours before a visit. Android may delay them. A clinic connection is required to verify the visit before delivery.", 12f, CareTokens.muted))
            addView(ui.button(if (enabled) "Turn reminders off" else "Enable reminders", 1) {
                if (enabled) vm.reminders(false)
                else if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                else vm.reminders(true)
            }.apply { isEnabled = !state.busy })
            if (BuildConfig.DEBUG && enabled) addView(ui.button("Send test reminder (10 seconds)", 2) { ConnectedReminders.test(this@ConnectedActivity, state.session.userId); Toast.makeText(this@ConnectedActivity, "Test reminder scheduled", Toast.LENGTH_SHORT).show() })
        }
        ui.gap(content, 14)
        content.addView(ui.button(if (state.busy) "Please wait…" else "Sign out", 3) { vm.signOut() }.apply { isEnabled = !state.busy })
        ui.gap(content, 10)
        content.addView(ui.text("Signing out removes saved clinic information from this phone.", 12f, CareTokens.muted).apply { gravity = Gravity.CENTER })
    }
    private fun credentialsDialog(title: String, recovery: Boolean = false) {
        val box = ui.column().apply { setPadding(ui.dp(24), ui.dp(8), ui.dp(24), ui.dp(12)) }
        box.addView(ui.text(if (recovery) "Ask your clinic to verify your identity and issue a recovery code. No email is sent." else "Changing your password signs out every session. You will need to sign in again.", 13f, CareTokens.muted))
        val current = ui.input(box, if (recovery) "Recovery code" else "Current password", "").apply { isSaveEnabled = false; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; filters = arrayOf(android.text.InputFilter.LengthFilter(128)) }
        val next = ui.input(box, "New password", "").apply { isSaveEnabled = false; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; filters = arrayOf(android.text.InputFilter.LengthFilter(128)) }
        val confirm = ui.input(box, "Confirm new password", "").apply { isSaveEnabled = false; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; filters = arrayOf(android.text.InputFilter.LengthFilter(128)) }
        AlertDialog.Builder(this).setTitle(title).setView(ScrollView(this).apply { addView(box) }).setNegativeButton("Back", null).setPositiveButton(if (recovery) "Reset password" else "Change password", null).create().apply {
            setOnShowListener { getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                when { current.text.isBlank() -> current.error = "Enter ${if (recovery) "your recovery code" else "your current password"}."
                    next.text.length < 12 -> next.error = "Use at least 12 characters."
                    next.text.toString() != confirm.text.toString() -> confirm.error = "Passwords must match."
                    else -> { if (recovery) vm.recover(current.text.toString(), next.text.toString()) else vm.changePassword(current.text.toString(), next.text.toString()); current.text.clear(); next.text.clear(); confirm.text.clear(); dismiss() }
                }
            } }; show()
        }
    }

    private fun availability(content: LinearLayout, state: ConnectedState) {
        val doctor = JSONObject(state.selectedDoctor!!)
        val date = LocalDate.parse(state.slotDate!!)
        val data = state.slotData?.let { JSONObject(it) }
        content.addView(ui.button(if (state.rescheduling != null) "Back to my visits" else "Back to my clinic", 2) { if (state.rescheduling != null) vm.showVisits() else vm.screen(false) })
        ui.gap(content, 18)
        ui.heading(content, if (state.rescheduling != null) "Move your visit" else "Available times", "${data?.getJSONObject("doctor")?.getString("name") ?: doctor.getString("name")} · ${doctor.getString("clinic")}")
        if (state.rescheduling != null) content.addView(ui.text("Your current visit stays confirmed until a new time is saved.", 13f, CareTokens.muted))
        state.actionError?.let { content.addView(ui.text(it, 14f, CareTokens.danger).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }); content.addView(ui.button("Check my visits", 1) { vm.showVisits() }) }
        content.addView(ui.text("${data?.getJSONObject("doctor")?.getString("specialty") ?: doctor.getString("specialty")} · ${data?.getJSONObject("doctor")?.getInt("consultationMinutes") ?: doctor.getInt("consultationMinutes")} minute consultations", 14f, CareTokens.muted))
        content.addView(ui.text("All times use ${doctor.getString("timezone")}", 12f, CareTokens.muted))
        content.addView(ui.button(date.format(DateTimeFormatter.ofPattern("EEE, d MMM yyyy")), 1) {
            val today = LocalDate.now(ZoneId.of(doctor.getString("timezone")))
            DatePickerDialog(this, { _, year, month, day -> vm.availability(doctor, LocalDate.of(year, month + 1, day).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).apply {
                datePicker.minDate = today.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
                datePicker.maxDate = today.plusDays(90).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
                show()
            }
        }.apply { isEnabled = !state.bookingBusy; contentDescription = "Choose date, ${date.format(DateTimeFormatter.ofPattern("d MMMM yyyy"))}" })
        ui.gap(content, 20)
        when {
            state.slotLoading -> { content.addView(ProgressBar(this)); content.addView(ui.text("Checking the clinic schedule…", 14f, CareTokens.muted)) }
            state.slotError != null -> ui.card(content) {
                addView(ui.text("Times could not be checked", 17f, bold = true))
                addView(ui.text(state.slotError, 14f, CareTokens.muted))
                addView(ui.button("Try again", 1) { vm.availability(doctor, state.slotDate) })
            }
            data != null -> {
                val slots = data.getJSONArray("slots")
                if (slots.length() == 0) ui.card(content) {
                    addView(ui.text("No available times", 18f, bold = true))
                    addView(ui.text("The doctor may be closed, taking time off, or finished for this date. Try another day.", 14f, CareTokens.muted))
                } else ui.card(content) {
                    addView(ui.text("${slots.length()} consultation times", 17f, bold = true))
                    for (index in 0 until slots.length()) {
                        val slot = slots.getJSONObject(index)
                        val currentTime = state.rescheduling?.let { JSONObject(it).getString("startsAt") == slot.getString("startsAt") } ?: false
                        addView(ui.button(if (state.bookingBusy) "Please wait…" else (if (currentTime) "Current · " else "") + slot.getString("label"), 1) {
                            val moving = state.rescheduling != null
                            AlertDialog.Builder(this@ConnectedActivity).setTitle(if (moving) "Confirm new time?" else "Confirm your visit?")
                                .setMessage("${doctor.getString("name")}\n${doctor.getString("clinic")}\n\n${date.format(DateTimeFormatter.ofPattern("EEE, d MMM yyyy"))}\n${slot.getString("label")}\n${doctor.getString("timezone")}\n\n${if (moving) "Your existing visit will move only if this time is still available." else "The clinic will check availability when you confirm."}")
                                .setNegativeButton("Back", null).setPositiveButton(if (moving) "Move visit" else "Confirm booking") { _, _ -> vm.reserve(slot) }.show()
                        }.apply { isEnabled = !state.bookingBusy && !currentTime; contentDescription = "${if (currentTime) "Current visit at" else if (state.rescheduling != null) "Move visit to" else "Book"} ${slot.getString("label")}" })
                    }
                }
            }
        }
        ui.card(content, CareTokens.sage) {
            addView(ui.text("Plan your visit", 17f, bold = true))
            addView(ui.text("Choose a time to review and confirm. A time is reserved only after the clinic confirms your booking. All changes need a live connection.", 13f, CareTokens.muted))
        }
    }

    private fun visitTime(value: String, timezone: String): String = java.time.Instant.parse(value).atZone(ZoneId.of(timezone)).format(DateTimeFormatter.ofPattern("EEE, d MMM yyyy · h:mm a"))
    private fun care(content: LinearLayout, state: ConnectedState) {
        ui.heading(content, "My care", "Your medicines, reminders and private health documents.")
        content.addView(ui.careSections("prescriptions") { target -> if (target != "prescriptions") careTools(target) })
        state.careNotice?.let { ui.card(content, CareTokens.sage) { addView(ui.text(it, 14f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) } }
        state.careError?.let { ui.card(content) { addView(ui.text("Care records need attention", 17f, bold = true)); addView(ui.text(it, 14f, CareTokens.muted)) } }
        if (state.careLoading) { content.addView(ProgressBar(this)); content.addView(ui.text("Checking your prescriptions…", 14f, CareTokens.muted)) }
        val data = state.careData?.let { JSONObject(it) }
        savedNotice(content, data)
        val items = data?.getJSONArray("items")
        if (items?.length() == 0 && !state.careLoading && state.careError == null) ui.card(content) {
            addView(ui.text("No prescriptions yet", 18f, bold = true))
            addView(ui.text("Prescriptions will appear here when your doctor issues them after an attended visit.", 14f, CareTokens.muted))
        }
        if (items != null) for (index in 0 until items.length()) {
            val rx = items.getJSONObject(index)
            val timezone = rx.getJSONObject("clinic").getString("timezone")
            val requests = rx.getJSONArray("refillRequests")
            ui.card(content) {
                addView(ui.badge(if (rx.isNull("renewalOfId")) "Visit prescription" else "Renewal prescription"))
                if (rx.optString("documentStatus", "ACTIVE") != "ACTIVE") addView(ui.text(rx.getString("documentStatus"), 14f, CareTokens.danger, bold = true))
                addView(ui.button("Prescription PDF & verification", 2) { careTools("prescriptions", rx.getString("id")) })
                ui.gap(this, 12)
                addView(ui.text(rx.getJSONObject("doctor").getString("name"), 18f, bold = true))
                addView(ui.text(rx.getJSONObject("clinic").getString("name"), 13f, CareTokens.muted))
                addView(ui.text("Issued ${visitTime(rx.getString("issuedAt"), timezone)}", 12f, CareTokens.muted))
                addView(ui.text("Visit ${visitTime(rx.getString("visitStartsAt"), timezone)}", 12f, CareTokens.muted))
                val medicines = rx.getJSONArray("medicines")
                for (medIndex in 0 until medicines.length()) {
                    val medicine = medicines.getJSONObject(medIndex)
                    ui.rule(this)
                    addView(ui.text(medicine.getString("name"), 17f, bold = true))
                    addView(ui.text("Dose: ${medicine.getString("dose")}", 14f))
                    addView(ui.text("Frequency: ${medicine.getString("frequency")}", 14f))
                    addView(ui.text("Duration: ${medicine.getString("duration")}", 14f))
                    medicine.optString("instructions").takeIf { it.isNotBlank() }?.let { addView(ui.text(it, 14f, CareTokens.muted)) }
                }
                rx.optString("notes").takeIf { it.isNotBlank() }?.let { ui.rule(this); addView(ui.text("Additional instructions", 13f, bold = true)); addView(ui.text(it, 14f)) }
                if (!rx.isNull("renewalId")) { ui.gap(this, 12); addView(ui.text("A newer prescription has been issued. This record is kept as history.", 13f, CareTokens.muted)) }
                if (requests.length() > 0) {
                    ui.rule(this)
                    val latest = requests.getJSONObject(0)
                    addView(ui.text("Latest refill: ${latest.getString("status").lowercase().replaceFirstChar { it.uppercase() }}", 14f, bold = true))
                    if (!latest.isNull("reviewNote")) addView(ui.text(latest.getString("reviewNote"), 14f, CareTokens.muted))
                    addView(ui.button("Refill history", 2) {
                        val history = (0 until requests.length()).joinToString("\n\n") { i ->
                            val request = requests.getJSONObject(i)
                            "${request.getString("status").lowercase().replaceFirstChar { it.uppercase() }} · ${visitTime(request.getString("requestedAt"), timezone)}\nYour note: ${request.getString("patientNote")}" +
                                (if (!request.isNull("reviewNote")) "\nDoctor's note: ${request.getString("reviewNote")}\nReviewed ${visitTime(request.getString("reviewedAt"), timezone)}" else "\nWaiting for your doctor.")
                        }
                        AlertDialog.Builder(this@ConnectedActivity).setTitle("Refill history").setMessage("$history\n\nAll times: $timezone").setPositiveButton("Close", null).show()
                    })
                }
                if (rx.getBoolean("canRequestRefill") && !data.has("_savedAt")) addView(ui.button(if (state.careBusy) "Please wait…" else "Request refill", 1) { refillDialog(rx) }.apply { isEnabled = !state.careBusy && !state.careLoading })
            }
        }
        if (data != null && !data.isNull("nextCursor")) content.addView(ui.button("Load more prescriptions", 1) { vm.showCare(true) }.apply { isEnabled = !state.careLoading && !state.careBusy })
        content.addView(ui.button("Refresh care", 2) { vm.showCare() }.apply { isEnabled = !state.careLoading && !state.careBusy })
    }
    private fun refillDialog(rx: JSONObject) {
        val id = rx.getString("id")
        val box = ui.column().apply { setPadding(ui.dp(24), ui.dp(8), ui.dp(24), 0) }
        box.addView(ui.text("Your doctor will review this prescription before deciding whether to issue a renewal.", 14f, CareTokens.muted))
        val input = ui.input(box, "Note for your doctor", vm.refillDrafts[id] ?: "").apply {
            setSingleLine(false); minLines = 2; maxLines = 5
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            filters = arrayOf(android.text.InputFilter.LengthFilter(1000))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { vm.refillDrafts[id] = s?.toString() ?: "" }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        AlertDialog.Builder(this).setTitle("Request a refill?").setView(box).setNegativeButton("Back", null).setPositiveButton("Send request", null).create().apply {
            setOnShowListener {
                getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val note = input.text.toString().trim()
                    if (note.length < 2) input.error = "Add a brief note for your doctor."
                    else { vm.requestRefill(id, note); dismiss() }
                }
            }
            show()
        }
    }
    private fun visits(content: LinearLayout, state: ConnectedState) {
        ui.heading(content, "Your visits", "Confirmed appointments, with your clinic's latest updates.")
        state.actionNotice?.let { ui.card(content, CareTokens.sage) { addView(ui.text(it, 14f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) } }
        state.actionError?.let { content.addView(ui.text(it, 14f, CareTokens.danger)) }
        content.addView(ui.row().apply {
            listOf("Upcoming" to false, "Past & cancelled" to true).forEach { (label, past) ->
                addView(ui.button(label, if (past == state.visitsPast) 1 else 2) { vm.showVisits(past) }.apply { isSelected = past == state.visitsPast; isEnabled = !state.bookingBusy }, LinearLayout.LayoutParams(0, -2, 1f))
            }
        })
        ui.gap(content, 20)
        if (state.visitsLoading) { content.addView(ProgressBar(this)); content.addView(ui.text("Checking your visits…", 14f, CareTokens.muted)) }
        state.visitsError?.let { ui.card(content) { addView(ui.text("Visits could not be checked", 17f, bold = true)); addView(ui.text(it, 14f, CareTokens.muted)) } }
        val data = state.visitsData?.let { JSONObject(it) }
        savedNotice(content, data)
        val items = data?.getJSONArray("items")
        if (!state.visitsLoading && state.visitsError == null && items?.length() == 0) ui.card(content) {
            addView(ui.text(if (state.visitsPast) "No past visits yet" else "No upcoming visits", 18f, bold = true))
            addView(ui.text(if (state.visitsPast) "Completed, missed and cancelled visits will appear here." else "Choose a doctor in My clinic to find a suitable consultation time.", 14f, CareTokens.muted))
        }
        if (items != null) for (index in 0 until items.length()) {
            val visit = items.getJSONObject(index)
            val clinic = visit.getJSONObject("clinic")
            val doctor = visit.getJSONObject("doctor")
            val timezone = clinic.getString("timezone")
            ui.card(content) {
                addView(ui.text(doctor.getString("name"), 18f, bold = true))
                addView(ui.text("${doctor.getString("specialty")} · ${clinic.getString("name")}", 13f, CareTokens.muted))
                ui.gap(this, 12)
                addView(ui.text(visitTime(visit.getString("startsAt"), timezone), 15f, bold = true))
                addView(ui.text("${java.time.Duration.between(java.time.Instant.parse(visit.getString("startsAt")), java.time.Instant.parse(visit.getString("endsAt"))).toMinutes()} minutes · $timezone", 12f, CareTokens.muted))
                ui.gap(this, 10)
                addView(ui.badge(visit.getString("status").lowercase().replaceFirstChar { it.uppercase() }))
                visit.optJSONObject("cancellation")?.let { cancellation ->
                    ui.gap(this, 10)
                    addView(ui.text(cancellation.getString("label"), 14f, bold = true))
                    addView(ui.text("Cancelled ${visitTime(cancellation.getString("at"), timezone)}", 12f, CareTokens.muted))
                }
                val prediction = visit.optJSONObject("prediction")
                if (prediction != null) {
                    ui.gap(this, 10)
                    val available = prediction.optString("status") == "AVAILABLE" && !prediction.isNull("attendanceProbability")
                    val estimate = if (available) "${kotlin.math.round(prediction.getDouble("attendanceProbability") * 100).toInt()}%" else "Unavailable"
                    addView(ui.text("Experimental attendance estimate: $estimate", 13f, CareTokens.muted))
                    addView(ui.button("About this estimate", 2) {
                        AlertDialog.Builder(this@ConnectedActivity).setTitle("Experimental attendance estimate")
                            .setMessage((if (available) "Estimated attendance: $estimate\n\n" else "An estimate could not be recorded.\n\n") + "Calculated by the clinic service when this visit was booked or moved, using a model trained on fictional records. It is not a validated judgement about you and does not change your confirmed time.\n\n" + (if (!prediction.isNull("modelVersion")) "Model: ${prediction.getString("modelVersion")}\n" else "") + "Recorded: ${visitTime(prediction.getString("asOf"), timezone)}\n\nStandard booking rules apply.")
                            .setPositiveButton("Close", null).show()
                    })
                }
                if (visit.getBoolean("needsReview")) { ui.gap(this, 10); addView(ui.text("Clinic schedule changed. Your visit keeps this confirmed time. Contact the clinic or choose a new time.", 13f, CareTokens.danger)) }
                if (!data!!.has("_savedAt") && visit.getString("status") == "BOOKED" && java.time.Instant.parse(visit.getString("startsAt")).isAfter(java.time.Instant.now())) {
                    addView(ui.button("Reschedule", 1) { vm.reschedule(visit) }.apply { isEnabled = !state.bookingBusy && !state.visitsLoading })
                    addView(ui.button(if (state.bookingBusy) "Please wait…" else "Cancel visit", 3) {
                        AlertDialog.Builder(this@ConnectedActivity).setTitle("Cancel this visit?").setMessage("${doctor.getString("name")}\n${visitTime(visit.getString("startsAt"), timezone)}\n$timezone\n\nThis releases your consultation time. The record stays in Past & cancelled.")
                            .setNegativeButton("Keep visit", null).setPositiveButton("Cancel visit") { _, _ -> vm.cancelVisit(visit) }.show()
                    }.apply { isEnabled = !state.bookingBusy && !state.visitsLoading })
                }
                addView(ui.button("Visit documents & follow-up", 2) { careTools("appointments", visit.getString("id")) })
                addView(ui.button("Visit history", 2) {
                    val events = visit.getJSONArray("events")
                    val labels = mapOf("BOOKED" to "Booking confirmed", "RESCHEDULED" to "Rescheduled", "CANCELLED" to "Cancelled", "ATTENDED" to "Attendance recorded", "MISSED" to "Marked missed", "SCHEDULE_REVIEW_REQUIRED" to "Clinic schedule changed", "SCHEDULE_REVIEW_CLEARED" to "Schedule conflict cleared")
                    val text = (0 until events.length()).joinToString("\n\n") { i ->
                        val event = events.getJSONObject(i)
                        "${event.optJSONObject("cancelledBy")?.optString("label") ?: labels[event.getString("action")] ?: event.getString("action")}\n${visitTime(event.getString("createdAt"), timezone)}\n" +
                            (if (!event.isNull("fromStartsAt")) "From: ${visitTime(event.getString("fromStartsAt"), timezone)}\n" else "") + "Visit: ${visitTime(event.getString("toStartsAt"), timezone)}"
                    }
                    AlertDialog.Builder(this@ConnectedActivity).setTitle("Visit history").setMessage("$text\n\nAll times: $timezone").setPositiveButton("Close", null).show()
                })
            }
        }
        if (data != null && !data.isNull("nextCursor")) content.addView(ui.button("Load more visits", 1) { vm.showVisits(state.visitsPast, true) }.apply { isEnabled = !state.visitsLoading && !state.bookingBusy })
        content.addView(ui.button("Refresh visits", 2) { vm.showVisits(state.visitsPast) }.apply { isEnabled = !state.visitsLoading && !state.bookingBusy })
    }
    private fun savedNotice(content: LinearLayout, data: JSONObject?) {
        if (data?.has("_savedAt") == true) ui.card(content, CareTokens.sage) {
            addView(ui.text("Saved copy · read only", 15f, bold = true))
            addView(ui.text("Last checked ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(data.getLong("_savedAt")))}. Clinic changes may not appear yet. Reconnect and refresh before making changes. Only the most recently loaded first page is saved.", 13f, CareTokens.muted))
        }
    }
}
