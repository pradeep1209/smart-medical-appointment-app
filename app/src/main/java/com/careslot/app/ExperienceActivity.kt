package com.careslot.app

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.text.InputType
import android.util.Base64
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.Executors

/** Patient-owned tools. Clinical writes remain server-authorized and are never queued offline. */
class ExperienceActivity : ComponentActivity() {
    private val ui by lazy { UiKit(this) }
    private val repository by lazy { ConnectedRepository(this) }
    private val worker = Executors.newSingleThreadExecutor()
    private var owner = ""
    private var section = "home"
    private var recordId: String? = null
    private var returnToInbox = false
    private var data: JSONObject? = null
    private var error: String? = null
    private var message: String? = null
    private var busy = false
    private var pendingFile: String? = null
    private var pendingMime = "application/pdf"
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { load() }
    private val saveFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        val source = pendingFile?.let { File(it) }
        if (result.resultCode == RESULT_OK && uri != null && source?.exists() == true) {
            async({
                checkOwner()
                contentResolver.openOutputStream(uri, "wt")!!.use { out -> source.inputStream().use { it.copyTo(out) } }
                "File saved to your selected location."
            }) { message = it; render() }
        }
    }
    private val pickDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) async({
            checkOwner()
            val filename = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "Report.pdf"
            val mime = contentResolver.getType(uri) ?: if (filename.endsWith(".pdf", true)) "application/pdf" else ""
            require(mime in listOf("application/pdf", "image/png", "image/jpeg")) { "Choose a PDF, PNG or JPEG document." }
            val bytes = ByteArrayOutputStream()
            contentResolver.openInputStream(uri)!!.use { input -> val chunk = ByteArray(8192); while (true) { val count = input.read(chunk); if (count < 0) break; require(bytes.size() + count <= 5 * 1024 * 1024) { "Choose a document no larger than 5 MB." }; bytes.write(chunk, 0, count) } }
            Triple(filename, mime, Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
        }) { file -> form("Save a private document", listOf(Field("title", "Document title", file.first.substringBeforeLast('.'), 120)), "/experience/documents", "Upload document", extra = { JSONObject().put("filename", file.first).put("mime", file.second).put("dataBase64", file.third) }) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = CareTokens.canvas; window.navigationBarColor = Color.WHITE
        owner = repository.vault.read()?.userId ?: run { finish(); return }
        if (intent.getStringExtra("reminderUserId")?.let { it != owner } == true) { finish(); return }
        section = savedInstanceState?.getString("section") ?: intent.getStringExtra("section") ?: "documents"
        if (section == "home") section = "documents"
        recordId = savedInstanceState?.getString("recordId") ?: intent.getStringExtra("recordId")
        returnToInbox = savedInstanceState?.getBoolean("returnToInbox") ?: false
        pendingFile = savedInstanceState?.getString("pendingFile")
        pendingMime = savedInstanceState?.getString("pendingMime") ?: pendingMime
        onBackPressedDispatcher.addCallback(this) { backToParent() }
        render(); load()
    }
    override fun onSaveInstanceState(out: Bundle) { out.putString("section", section); out.putString("recordId", recordId); out.putBoolean("returnToInbox",returnToInbox); out.putString("pendingFile", pendingFile); out.putString("pendingMime", pendingMime); super.onSaveInstanceState(out) }
    override fun onResume() { super.onResume(); if (owner.isNotBlank()) { if (repository.vault.read()?.userId != owner) finish() else if (data != null) load() } }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); if (intent.getStringExtra("reminderUserId")?.let { it != owner } == true) { finish(); return }; section = intent.getStringExtra("section") ?: "documents"; recordId = intent.getStringExtra("recordId"); returnToInbox=false; render(); load() }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
    private fun checkOwner() { check(repository.vault.read()?.userId == owner) { "Your account changed. Reopen these tools after signing in." } }
    private fun <T> async(work: () -> T, done: (T) -> Unit) {
        if (busy) return
        busy = true; error = null
        worker.execute {
            try { checkOwner(); val result = work(); runOnUiThread { if (!isFinishing && !isDestroyed) { busy = false; if (repository.vault.read()?.userId == owner) done(result) else finish() } } }
            catch (failure: Exception) { runOnUiThread { if (!isFinishing && !isDestroyed) { busy = false; error = if (failure is java.io.IOException) "The clinic could not be reached. Connect to the clinic Wi-Fi and try again." else failure.message ?: "Please try again."; render() } } }
        }
    }
    private fun load() = async({ repository.experience().also { result ->
        val key = if (section == "appointments") "visits" else if (section == "prescriptions") "prescriptions" else null
        if (key != null && recordId != null) { val list = result.getJSONArray(key); if ((0 until list.length()).none { list.getJSONObject(it).getString("id") == recordId }) list.put(repository.experienceRecord("/experience/$key/$recordId")) }
        MedicationReminders.reconcile(this, owner, result.getJSONArray("plans"))
    } }) { data = it; render() }
    private fun change(path: String, body: JSONObject = JSONObject()) = async({ repository.experienceAction(path, body) }) { message = it.optString("message", "Saved."); load() }
    private fun open(value: String, id: String? = null) { if(section=="notifications" && value!="notifications") returnToInbox=true; section = value; recordId = id; error = null; message = null; render() }
    private fun backToParent() { if(returnToInbox) { returnToInbox=false; open("notifications") } else navigate(returnDestination()) }
    private fun activeDestination() = when (section) { "notifications" -> "inbox"; "appointments" -> "visits"; "profile", "export" -> "account"; else -> "care" }
    private fun returnDestination() = if (section == "notifications") "clinic" else activeDestination()
    private fun navigate(target: String) {
        if (repository.vault.read()?.userId != owner) { finish(); return }
        startActivity(Intent(this, ConnectedActivity::class.java).putExtra("navigationTab", target).putExtra("navigationUserId", owner).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }
    private fun render() {
        val root = ui.column().apply { setBackgroundColor(CareTokens.canvas) }
        val header = ui.row().apply { setPadding(ui.dp(24),ui.dp(18),ui.dp(24),ui.dp(12)) }
        header.addView(ui.brand(), LinearLayout.LayoutParams(0,-2,1f))
        header.addView(FrameLayout(this).apply {
            addView(ui.icon("person",CareTokens.ink,24),FrameLayout.LayoutParams(ui.dp(24),ui.dp(24),android.view.Gravity.CENTER))
            isClickable=true; isFocusable=true; contentDescription="My account"; setOnClickListener { navigate("account") }
        }, LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)))
        root.addView(header)
        val content = ui.column().apply { setPadding(ui.dp(24),ui.dp(20),ui.dp(24),ui.dp(24)) }
        val frame = FrameLayout(this).apply { addView(content, FrameLayout.LayoutParams(if (resources.configuration.screenWidthDp > 650) ui.dp(560) else -1,-2,android.view.Gravity.TOP or android.view.Gravity.CENTER_HORIZONTAL)) }
        root.addView(ScrollView(this).apply { isFillViewport=true; addView(frame) }, LinearLayout.LayoutParams(-1,0,1f))
        root.addView(ui.patientNavigation(activeDestination()) { target -> if (target != "inbox" || section != "notifications") navigate(target) })
        setContentView(root)
        val careRoot = section in listOf("prescriptions","medication","documents") && recordId == null
        if (!careRoot && section != "notifications") content.addView(ui.button(if(returnToInbox) "Back to notifications" else when (activeDestination()) { "account" -> "Back to account"; "visits" -> "Back to visits"; else -> "Back to medicines" },2) { backToParent() })
        val titles = mapOf("prescriptions" to "Prescription documents", "appointments" to "Visit documents", "medication" to "Medication reminders", "documents" to "Health documents", "notifications" to "Notifications", "profile" to "Your health details", "export" to "Export care history")
        val descriptions = mapOf("appointments" to "Your visit details and instructions from your doctor.", "notifications" to "Updates from your clinic and care team.", "profile" to "Optional information for your assigned doctor.", "export" to "Choose the care records you want to keep.")
        ui.heading(content, if (careRoot) "My care" else titles[section] ?: "My care", if (careRoot) "Your medicines, reminders and private health documents." else descriptions[section] ?: "Issued details and current prescription status.")
        if (careRoot) {
            content.addView(ui.careSections(section) { target -> if (target == "prescriptions") navigate("care") else if (target != section) open(target) })
            content.addView(ui.text(titles[section] ?: "Health documents",18f,bold=true)); ui.gap(content,12)
        }
        error?.let { content.addView(ui.text(it, 14f, CareTokens.danger).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) }
        message?.let { content.addView(ui.text(it, 14f, CareTokens.teal).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) }
        if (data == null) { content.addView(ui.button("Connect and refresh", 1) { load() }); if (busy) content.addView(ProgressBar(this)); return }
        when (section) {
            "prescriptions" -> prescriptions(content)
            "appointments" -> appointments(content)
            "medication" -> medication(content)
            "documents" -> documents(content)
            "notifications" -> notifications(content)
            "profile" -> profile(content)
            "export" -> history(content)
            else -> documents(content)
        }
        ui.gap(content, 18); content.addView(ui.button(if (busy) "Refreshing…" else when(section) { "notifications" -> "Refresh notifications"; "medication" -> "Refresh reminders"; "documents" -> "Refresh documents"; else -> "Refresh records" }, 2) { load() }.apply { isEnabled = !busy }); ui.gap(content, 24)
    }
    private fun array(name: String) = data!!.optJSONArray(name) ?: JSONArray()
    private fun rows(name: String) = (0 until array(name).length()).map { array(name).getJSONObject(it) }
    private fun timestamp(value: String) = Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("d MMM yyyy · h:mm a"))
    private fun download(kind: String, id: String? = null, action: String = "preview", extra: JSONObject = JSONObject()) = async({
        val payload = JSONObject(extra.toString()).put("kind", kind); if (id != null) payload.put("id", id)
        if (kind == "history") payload.put("timezone", ZoneId.systemDefault().id)
        val result = repository.experienceAction("/experience/exports", payload)
        val folder = File(cacheDir, "exports/$owner/${UUID.randomUUID()}").apply { mkdirs() }
        val name = result.getString("filename").replace(Regex("[^A-Za-z0-9._-]"), "_")
        val file = File(folder, name)
        file.writeBytes(Base64.decode(result.getString("base64"), Base64.DEFAULT)); Triple(file, result.getString("mime"), name)
    }) { result ->
        val (file, mime, name) = result
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        try {
            when (action) {
                "save" -> { pendingFile = file.absolutePath; pendingMime = mime; saveFile.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, name)) }
                "share" -> startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).apply { clipData = android.content.ClipData.newRawUri(name, uri) }, "Share your selected document"))
                else -> startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            }
        } catch (_: android.content.ActivityNotFoundException) { message = "No viewer is available for this file. Use Save or Share instead."; render() }
    }
    private fun fileButtons(parent: LinearLayout, kind: String, id: String) {
        parent.addView(ui.button(if (kind == "document") "Open document" else "Preview PDF", 2) { download(kind, id) })
        parent.addView(ui.button(if (kind == "document") "Save document" else "Save PDF", 1) { download(kind, id, "save") })
        parent.addView(ui.button(if (kind == "document") "Share document" else "Share PDF", 2) { download(kind, id, "share") })
    }
    private fun prescriptions(content: LinearLayout) {
        val records = rows("prescriptions").filter { recordId == null || it.getString("id") == recordId }
        if (records.isEmpty()) content.addView(ui.text("No prescription documents in this view. Refresh or open a recent prescription.", 14f, CareTokens.muted))
        for (rx in records) ui.card(content) {
            addView(ui.text(rx.optString("documentNumber").takeUnless { it == "null" || it.isBlank() } ?: "Issued prescription", 17f, bold = true))
            addView(ui.text("${rx.getString("doctor")} · ${rx.getString("clinic")}", 13f, CareTokens.muted))
            addView(ui.text("${rx.getString("status")} · ${timestamp(rx.getString("issuedAt"))}", 13f, bold = true))
            val medicines = rx.getJSONArray("medicines")
            for (i in 0 until medicines.length()) { val m = medicines.getJSONObject(i); ui.rule(this); addView(ui.text(m.getString("name"), 16f, bold = true)); addView(ui.text("Dose: ${m.getString("dose")}\nFrequency: ${m.getString("frequency")}\nDuration: ${m.getString("duration")}", 14f)); if (m.optString("instructions").isNotBlank()) addView(ui.text(m.getString("instructions"), 13f, CareTokens.muted)) }
            if (rx.optString("notes").isNotBlank()) addView(ui.text(rx.getString("notes"), 14f))
            if (rx.optString("changeReason").isNotBlank()) addView(ui.text(rx.getString("changeReason"), 13f, CareTokens.muted))
            if (!rx.isNull("replacement")) addView(ui.text("A replacement document is available. Use the current prescription.", 13f, CareTokens.muted))
            fileButtons(this, "prescription", rx.getString("id"))
            addView(ui.button("Verify current status", 2) { async({ repository.experienceAction("/experience/prescriptions/${rx.getString("id")}/verification", JSONObject()) }) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it.getString("url")))) } })
        }
        if (data!!.getJSONObject("limits").optBoolean("prescriptions")) content.addView(ui.text("Showing the latest 100 prescription documents.", 12f, CareTokens.muted))
    }
    private fun appointments(content: LinearLayout) {
        val visits = rows("visits").filter { recordId == null || it.getString("id") == recordId }
        if (visits.isEmpty()) content.addView(ui.text("No visits in this view.", 14f, CareTokens.muted))
        for (a in visits) ui.card(content) {
            val doctor = a.getJSONObject("doctor"); val clinic = a.getJSONObject("clinic")
            addView(ui.text(doctor.getString("name"), 18f, bold = true)); addView(ui.text("${clinic.getString("name")}\n${timestamp(a.getString("startsAt"))}\n${a.getString("status")}", 14f))
            fileButtons(this, "appointment", a.getString("id"))
            addView(ui.button("Add to calendar", 2) {
                try { startActivity(Intent(Intent.ACTION_INSERT, android.provider.CalendarContract.Events.CONTENT_URI)
                    .putExtra(android.provider.CalendarContract.Events.TITLE, "Consultation with ${doctor.getString("name")}")
                    .putExtra(android.provider.CalendarContract.EXTRA_EVENT_BEGIN_TIME, Instant.parse(a.getString("startsAt")).toEpochMilli())
                    .putExtra(android.provider.CalendarContract.EXTRA_EVENT_END_TIME, Instant.parse(a.getString("endsAt")).toEpochMilli())
                    .putExtra(android.provider.CalendarContract.Events.EVENT_TIMEZONE, a.getString("timezone"))
                    .putExtra(android.provider.CalendarContract.Events.EVENT_LOCATION, clinic.optString("address"))
                    .putExtra(android.provider.CalendarContract.Events.DESCRIPTION, "${clinic.getString("name")}. Check CareSlot for the latest visit status.")) }
                catch (_: android.content.ActivityNotFoundException) { download("calendar", a.getString("id"), "save") }
            }.apply { isEnabled = a.getString("status") == "BOOKED" })
            addView(ui.button("Save calendar file", 2) { download("calendar", a.getString("id"), "save") })
            if (clinic.optString("address").isNotBlank()) addView(ui.button("Clinic directions", 2) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=${Uri.encode(clinic.getString("address"))}"))) })
            a.optJSONObject("summary")?.takeUnless { it.isNull("issuedAt") }?.let { summary ->
                ui.rule(this); addView(ui.text("Consultation summary", 17f, bold = true)); addView(ui.text(summary.getString("summary"), 14f)); addView(ui.text("Instructions\n${summary.getString("instructions")}", 14f))
                if (!summary.isNull("followUpDate")) {
                    val recommended = summary.getString("followUpDate")
                    addView(ui.text("Recommended follow-up: $recommended\n${summary.getString("followUpInstructions")}", 14f, bold = true))
                    addView(ui.button("Book recommended follow-up", 1) {
                        val payload = JSONObject(doctor.toString()).put("clinicId", clinic.getString("id")).put("clinic", clinic.getString("name")).put("timezone", a.getString("timezone"))
                        val today = LocalDate.now(ZoneId.of(a.getString("timezone"))).toString()
                        startActivity(Intent(this@ExperienceActivity, ConnectedActivity::class.java).putExtra("followupDoctor", payload.toString()).putExtra("followupDate", maxOf(today, recommended)).putExtra("followupUserId", owner).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)); finish()
                    })
                }
            }
        }
        if (data!!.getJSONObject("limits").optBoolean("visits")) content.addView(ui.text("Showing the latest 100 visits. Export a selected history period for earlier records.", 12f, CareTokens.muted))
    }
    private fun notifications(content: LinearLayout) {
        content.addView(ui.button("Mark all read", 2) { change("/experience/notices/read-all") }.apply { isEnabled = !busy && rows("notices").any { it.isNull("readAt") } })
        if (rows("notices").isEmpty()) content.addView(ui.text("No notifications yet. New appointment changes and care decisions will appear here.", 14f, CareTokens.muted))
        for (n in rows("notices")) ui.card(content) {
            addView(ui.text(n.getString("title"), 17f, bold = true)); addView(ui.text(n.getString("body"), 14f)); addView(ui.text(timestamp(n.getString("createdAt")), 12f, CareTokens.muted))
            if (n.isNull("readAt")) addView(ui.button("Mark read", 2) { change("/experience/notices/${n.getString("id")}/read") })
            addView(ui.button("Open related records", 2) { open(if (n.getString("targetType") in listOf("PRESCRIPTION", "REFILL")) "prescriptions" else if (n.getString("targetType") == "DOCUMENT") "documents" else "appointments") })
        }
    }
    private fun profile(content: LinearLayout) {
        val p = data!!.getJSONObject("profile")
        ui.card(content) { addView(ui.text("Patient-provided details", 18f, bold = true)); addView(ui.text("Optional details visible to doctors assigned to your visits. Leave anything you do not want to provide blank.", 13f, CareTokens.muted)); for ((key, label) in listOf("phone" to "Phone", "dateOfBirth" to "Date of birth", "allergies" to "Allergies", "healthNotes" to "Health notes")) addView(ui.text("$label: ${p.optString(key).takeUnless { it == "null" || it.isBlank() } ?: "Not provided"}", 14f)); addView(ui.button("Edit health details", 1) {
            form("Your health details", listOf(Field("phone", "Phone", p.optString("phone"), 40, false), Field("dateOfBirth", "Date of birth · YYYY-MM-DD", p.optString("dateOfBirth").takeUnless { it == "null" } ?: "", 10, false), Field("allergies", "Allergies", p.optString("allergies"), 1000, false, true), Field("healthNotes", "Health notes", p.optString("healthNotes"), 2000, false, true)), "/experience/profiles/patient", extra = { JSONObject().put("version", p.getInt("profileVersion")) }, transform = { if (it.optString("dateOfBirth").isBlank()) it.put("dateOfBirth", JSONObject.NULL); it })
        }) }
    }
    private fun documents(content: LinearLayout) {
        content.addView(ui.text("PDF, PNG or JPEG · up to 5 MB each · 20 documents / 50 MB total. Sharing is optional and can be revoked.", 13f, CareTokens.muted))
        content.addView(ui.button("Upload a document", 1) { pickDocument.launch(arrayOf("application/pdf", "image/png", "image/jpeg")) })
        if (rows("documents").isEmpty()) content.addView(ui.text("Your private document folder is empty.", 14f, CareTokens.muted))
        for (doc in rows("documents")) ui.card(content) {
            addView(ui.text(doc.getString("title"), 17f, bold = true)); addView(ui.text("${doc.getString("filename")} · ${(doc.getInt("size") + 1023) / 1024} KB", 13f, CareTokens.muted)); fileButtons(this, "document", doc.getString("id"))
            addView(ui.button("Share for a visit", 1) {
                val visits = rows("visits").filter { it.getString("status") in listOf("BOOKED", "ATTENDED") }
                if (visits.isEmpty()) { message = "Book a visit or choose an attended consultation before sharing."; render() }
                else AlertDialog.Builder(this@ExperienceActivity).setTitle("Choose the consultation").setItems(visits.map { "${it.getJSONObject("doctor").getString("name")} · ${timestamp(it.getString("startsAt"))}" }.toTypedArray()) { _, index ->
                    val visit = visits[index]
                    AlertDialog.Builder(this@ExperienceActivity).setTitle("Share this document?").setMessage("The doctor assigned to this visit will be able to download this document. Access expires after the visit period and can be revoked at any time.").setNegativeButton("Back", null).setPositiveButton("Share") { _, _ -> change("/experience/documents/${doc.getString("id")}/share", JSONObject().put("appointmentId", visit.getString("id"))) }.show()
                }.show()
            })
            val grants = doc.getJSONArray("grants")
            for (i in 0 until grants.length()) { val g = grants.getJSONObject(i); if (g.isNull("revokedAt") && Instant.parse(g.getString("expiresAt")).isAfter(Instant.now())) { addView(ui.text("Shared with ${g.getJSONObject("doctor").getJSONObject("membership").getJSONObject("user").getString("displayName")} until ${timestamp(g.getString("expiresAt"))}", 13f, CareTokens.muted)); addView(ui.button("Revoke doctor access", 2) { change("/experience/document-grants/${g.getString("id")}/revoke") }) } }
            addView(ui.button("Remove document", 3) { AlertDialog.Builder(this@ExperienceActivity).setTitle("Remove this document?").setMessage("Its saved content and doctor access will be removed. Copies you already downloaded or shared outside CareSlot are separate.").setNegativeButton("Keep", null).setPositiveButton("Remove") { _, _ -> change("/experience/documents/${doc.getString("id")}/delete") }.show() })
        }
    }
    private fun history(content: LinearLayout) {
        content.addView(ui.text("Choose up to one year. The PDF contains your visits, issued summaries and prescriptions in that period. Uploaded reports are not included.", 14f, CareTokens.muted))
        val today = LocalDate.now()
        val from = ui.input(content, "From · YYYY-MM-DD", today.minusDays(90).toString()); val to = ui.input(content, "Through · YYYY-MM-DD", today.toString())
        content.addView(ui.button("Save care history PDF", 1) { try { LocalDate.parse(from.text.toString()); LocalDate.parse(to.text.toString()); download("history", action = "save", extra = JSONObject().put("from", from.text.toString()).put("to", to.text.toString())) } catch (_: Exception) { from.error = "Use YYYY-MM-DD dates." } })
        content.addView(ui.button("Share care history PDF", 2) { download("history", action = "share", extra = JSONObject().put("from", from.text.toString()).put("to", to.text.toString())) })
    }
    private fun medication(content: LinearLayout) {
        content.addView(ui.text("Confirm reminder times from your clinician's instructions. CareSlot does not calculate doses. Android may delay reminders; this local version needs the clinic connection to verify the prescription before delivery.", 14f, CareTokens.muted))
        if (!ConnectedReminders.permitted(this)) content.addView(ui.button("Allow reminder notifications", 1) { if (android.os.Build.VERSION.SDK_INT >= 33) permission.launch(android.Manifest.permission.POST_NOTIFICATIONS) else startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)) })
        content.addView(ui.button("Set medication reminders", 1) {
            val choices = mutableListOf<Pair<JSONObject, JSONObject>>()
            for (rx in rows("prescriptions")) if (rx.getString("status") == "ACTIVE" && rx.isNull("replacement") && (rx.isNull("renewalId") || rx.optString("renewalId").isBlank())) { val ms = rx.getJSONArray("medicines"); for (i in 0 until ms.length()) choices.add(rx to ms.getJSONObject(i)) }
            if (choices.isEmpty()) { message = "A current prescription is needed before creating a reminder."; render() }
            else AlertDialog.Builder(this).setTitle("Choose a prescribed medicine").setItems(choices.map { "${it.second.getString("name")} · ${it.first.getString("doctor")}" }.toTypedArray()) { _, i -> planForm(choices[i].second, rows("plans").find { it.getString("medicineId") == choices[i].second.getString("id") }) }.show()
        })
        for (p in rows("plans")) ui.card(content) {
            val zone = ZoneId.of(p.getString("timezone")); val today = LocalDate.now(zone)
            addView(ui.text(p.getString("medicine"), 18f, bold = true)); addView(ui.text("Dose: ${p.getString("dose")}\n${p.getJSONArray("times").let { times -> (0 until times.length()).joinToString(", ") { times.getString(it) } }} · ${p.getString("timezone")}\n${p.getString("startDate")} through ${p.getString("endDate")}", 14f)); addView(ui.text(if (!p.getBoolean("available")) "Prescription changed; reminder delivery is disabled." else if (p.getBoolean("enabled")) "Reminders enabled" else "Reminders off", 13f, CareTokens.muted))
            val medicine = JSONObject().put("id", p.getString("medicineId")).put("name", p.getString("medicine")).put("dose", p.getString("dose")).put("frequency", "Use your prescription").put("duration", "Use your prescription").put("instructions", p.getString("instructions"))
            if (p.getBoolean("available")) addView(ui.button("Edit reminder times", 2) { planForm(medicine, p) })
            addView(ui.button(if (p.getBoolean("enabled")) "Turn medication reminders off" else "Turn medication reminders on", 2) { change("/experience/medication-plans", JSONObject().put("medicineId", p.getString("medicineId")).put("times", p.getJSONArray("times")).put("timezone", p.getString("timezone")).put("startDate", p.getString("startDate")).put("endDate", p.getString("endDate")).put("enabled", !p.getBoolean("enabled")).put("version", p.getInt("version")).put("confirmed", true)) })
            val times = p.getJSONArray("times")
            if (today.toString() >= p.getString("startDate") && today.toString() <= p.getString("endDate")) for (i in 0 until times.length()) {
                val text = times.getString(i); val due = today.atTime(LocalTime.parse(text)).atZone(zone).toInstant()
                if (due <= Instant.now()) {
                    val logs = p.getJSONArray("logs"); val recorded = (0 until logs.length()).map { logs.getJSONObject(it) }.find { Instant.parse(it.getString("scheduledAt")) == due }
                    addView(ui.text("Today $text · ${recorded?.getString("status") ?: "Not recorded"}", 13f, bold = true))
                    for ((label, status) in listOf("Mark $text taken" to "TAKEN", "Mark $text skipped" to "SKIPPED")) addView(ui.button(label, 2) { change("/experience/medication-plans/${p.getString("id")}/log", JSONObject().put("scheduledAt", due.toString()).put("status", status)) })
                }
            }
            if (BuildConfig.DEBUG && p.getBoolean("available") && p.getBoolean("enabled")) addView(ui.button("Test medication reminder (10 seconds)", 2) { MedicationReminders.test(this@ExperienceActivity, owner, p); message = "Test reminder scheduled. Notification permission and a live clinic connection are required."; render() })
        }
    }
    private fun planForm(m: JSONObject, old: JSONObject?) {
        val today = LocalDate.now()
        val fields = listOf(Field("timesText", "Reminder times · HH:mm, separated by commas", old?.getJSONArray("times")?.let { (0 until it.length()).joinToString(", ") { i -> it.getString(i) } } ?: "08:00", 60), Field("startDate", "Start date · YYYY-MM-DD", old?.getString("startDate") ?: today.toString(), 10), Field("endDate", "End date · YYYY-MM-DD", old?.getString("endDate") ?: today.plusDays(7).toString(), 10))
        form("Confirm your reminder schedule", fields, "/experience/medication-plans", "Confirm reminder times", "${m.getString("name")}\nDose: ${m.getString("dose")}\nFrequency: ${m.getString("frequency")}\nDuration: ${m.getString("duration")}\n${m.optString("instructions")}\n\nOnly confirm times that match your clinician's instructions.", extra = { JSONObject().put("medicineId", m.getString("id")).put("version", old?.getInt("version") ?: 0).put("timezone", old?.getString("timezone") ?: ZoneId.systemDefault().id).put("enabled", true).put("confirmed", true) }, transform = { val times = it.getString("timesText").split(',').map(String::trim); require(times.isNotEmpty() && times.all { t -> Regex("([01]\\d|2[0-3]):[0-5]\\d").matches(t) }) { "Use HH:mm reminder times separated by commas." }; it.remove("timesText"); it.put("times", JSONArray(times)); it })
    }
    private data class Field(val key: String, val label: String, val value: String, val max: Int, val required: Boolean = true, val multiline: Boolean = false)
    private fun form(title: String, fields: List<Field>, path: String, action: String = "Save", help: String? = null, extra: () -> JSONObject = { JSONObject() }, transform: (JSONObject) -> JSONObject = { it }) {
        val column = ui.column().apply { setPadding(ui.dp(24), ui.dp(8), ui.dp(24), 0) }
        if (help != null) column.addView(ui.text(help, 13f, CareTokens.muted))
        val inputs = fields.associate { f -> f.key to ui.input(column, f.label, f.value).apply { contentDescription = f.label; filters = arrayOf(android.text.InputFilter.LengthFilter(f.max)); if (f.multiline) { setSingleLine(false); minLines = 3; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE } } }
        val feedback = ui.text("", 13f, CareTokens.danger).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }; column.addView(feedback)
        val dialog = AlertDialog.Builder(this).setTitle(title).setView(ScrollView(this).apply { addView(column) }).setNegativeButton("Back", null).setPositiveButton(action, null).create()
        dialog.setOnShowListener { dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            if (busy) return@setOnClickListener
            try {
                val body = extra(); for (f in fields) { val value = inputs[f.key]!!.text.toString().trim(); require(!f.required || value.isNotBlank()) { "Enter ${f.label.lowercase()}." }; body.put(f.key, value) }; val payload = transform(body)
                busy = true; feedback.text = "Saving…"; dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                worker.execute { try { checkOwner(); val result = repository.experienceAction(path, payload); runOnUiThread { busy = false; if (!isFinishing && !isDestroyed) { dialog.dismiss(); message = result.optString("message", "Saved."); load() } } } catch (failure: Exception) { runOnUiThread { busy = false; if (!isFinishing && !isDestroyed) { feedback.text = failure.message ?: "Please try again."; dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true } } } }
            } catch (failure: Exception) { feedback.text = failure.message ?: "Check the entered details." }
        } }
        dialog.show()
    }
}
