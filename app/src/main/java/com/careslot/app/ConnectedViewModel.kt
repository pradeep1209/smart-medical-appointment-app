package com.careslot.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.MutableLiveData
import java.io.IOException
import java.util.concurrent.Executors
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import org.json.JSONArray

data class ConnectedState(
    val loading: Boolean = true, val busy: Boolean = false, val session: ConnectedSession? = null,
    val cached: ConnectedCache? = null, val error: String? = null, val offline: Boolean = false,
    val accountScreen: Boolean = false, val register: Boolean = false, val logoutWarning: Boolean = false,
    val selectedDoctor: String? = null, val slotDate: String? = null, val slotData: String? = null,
    val slotLoading: Boolean = false, val slotError: String? = null,
    val visitsScreen: Boolean = false, val visitsPast: Boolean = false, val visitsData: String? = null,
    val visitsLoading: Boolean = false, val visitsError: String? = null, val rescheduling: String? = null,
    val bookingBusy: Boolean = false, val actionNotice: String? = null, val actionError: String? = null,
    val careScreen: Boolean = false, val careData: String? = null, val careLoading: Boolean = false,
    val careError: String? = null, val careBusy: Boolean = false, val careNotice: String? = null,
    val accountNotice: String? = null,
)
class ConnectedViewModel(application: Application) : AndroidViewModel(application) {
    val state = MutableLiveData(ConnectedState())
    private val worker = Executors.newSingleThreadExecutor()
    private val repository = ConnectedRepository(application)
    var email = ""; var name = ""; var password = ""
    var passwordVisible = false
    private var bookingChoice = ""
    private var bookingKey = ""
    private var visitsGeneration = 0
    private var careGeneration = 0
    private var refillChoice = ""
    private var refillKey = ""
    val refillDrafts = mutableMapOf<String, String>()
    init { load() }
    fun screen(account: Boolean) { state.value = state.value!!.copy(accountScreen = account, selectedDoctor = null, slotData = null, slotError = null, slotLoading = false, visitsScreen = false, rescheduling = null, actionError = null, actionNotice = null, careScreen = false, careNotice = null) }
    fun availability(doctor: JSONObject, date: String? = null) {
        val current = state.value!!
        val session = current.session ?: return
        val selected = doctor.toString()
        val selectedDate = date ?: LocalDate.now(ZoneId.of(doctor.getString("timezone"))).toString()
        if (current.bookingBusy) return
        val moveId = current.rescheduling?.let { JSONObject(it).getString("id") }
        state.value = current.copy(selectedDoctor = selected, slotDate = selectedDate, slotLoading = true, slotData = null, slotError = null, accountScreen = false, visitsScreen = false, actionError = null, careScreen = false)
        worker.execute {
            var result: String? = null
            var error: String? = null
            try { result = repository.availableTimes(doctor.getString("clinicId"), doctor.getString("id"), selectedDate, moveId).toString() }
            catch (_: IOException) { error = "Available times need a live clinic connection. Reconnect and try again." }
            catch (failure: ClinicApiException) { error = failure.message }
            catch (_: Exception) { error = "Available times could not be loaded. Try again." }
            Handler(Looper.getMainLooper()).post {
                val latest = state.value!!
                if (latest.session?.userId == session.userId && latest.selectedDoctor == selected && latest.slotDate == selectedDate) state.value = latest.copy(slotData = result, slotError = error, slotLoading = false)
            }
        }
    }
    fun showVisits(past: Boolean = false, more: Boolean = false, keepNotice: Boolean = false) {
        val current = state.value!!
        val userId = current.session?.userId ?: return
        val existing = if (more) current.visitsData?.let { JSONObject(it) } else null
        val cursor = existing?.optString("nextCursor")?.takeIf { it.isNotEmpty() && it != "null" }
        if (more && cursor == null) return
        val generation = ++visitsGeneration
        state.value = current.copy(visitsScreen = true, accountScreen = false, selectedDoctor = null, rescheduling = null, visitsPast = past, visitsLoading = true, visitsError = null, visitsData = existing?.toString(), actionError = null, actionNotice = if (keepNotice) current.actionNotice else null, careScreen = false)
        worker.execute {
            var data: String? = null
            var error: String? = null
            try {
                val loaded = repository.visits(past, cursor)
                if (existing != null) {
                    val merged = JSONArray()
                    val before = existing.getJSONArray("items")
                    val after = loaded.getJSONArray("items")
                    val ids = mutableSetOf<String>()
                    for (rows in listOf(before, after)) for (i in 0 until rows.length()) { val item = rows.getJSONObject(i); if (ids.add(item.getString("id"))) merged.put(item) }
                    loaded.put("items", merged)
                }
                data = loaded.toString()
                if (!loaded.has("_savedAt")) runCatching { repository.syncReminders() }
            } catch (_: IOException) { error = "Your visits need a live clinic connection. Reconnect and refresh." }
            catch (failure: ClinicApiException) { error = failure.message }
            catch (_: Exception) { error = "Your visits could not be loaded. Try again." }
            Handler(Looper.getMainLooper()).post {
                val latest = state.value!!
                if (repository.vault.read() == null) { state.value = ConnectedState(loading = false, error = "Your session has ended. Sign in again."); return@post }
                if (generation == visitsGeneration && latest.session?.userId == userId && latest.visitsScreen) state.value = latest.copy(visitsData = data, visitsError = error, visitsLoading = false)
            }
        }
    }
    fun reschedule(visit: JSONObject) {
        if (state.value!!.bookingBusy) return
        val doctor = JSONObject(visit.getJSONObject("doctor").toString()).put("consultationMinutes", java.time.Duration.between(java.time.Instant.parse(visit.getString("startsAt")), java.time.Instant.parse(visit.getString("endsAt"))).toMinutes().toInt())
        val clinic = visit.getJSONObject("clinic")
        state.value = state.value!!.copy(rescheduling = visit.toString(), actionNotice = null)
        availability(JSONObject(doctor.toString()).put("clinicId", clinic.getString("id")).put("clinic", clinic.getString("name")).put("timezone", clinic.getString("timezone")), java.time.Instant.parse(visit.getString("startsAt")).atZone(ZoneId.of(clinic.getString("timezone"))).toLocalDate().toString())
    }
    fun reserve(slot: JSONObject) {
        val current = state.value!!
        if (current.bookingBusy || current.selectedDoctor == null) return
        val doctor = JSONObject(current.selectedDoctor)
        val start = slot.getString("startsAt")
        val moving = current.rescheduling?.let { JSONObject(it) }
        val choice = "${doctor.getString("id")}|$start"
        if (choice != bookingChoice) { bookingChoice = choice; bookingKey = UUID.randomUUID().toString() }
        val key = bookingKey
        mutateVisit(false) {
            if (moving != null) repository.moveVisit(moving.getString("id"), moving.getInt("version"), start)
            else repository.book(doctor.getString("clinicId"), doctor.getString("id"), start, repository.requestIdentity("booking", choice))
        }
    }
    fun cancelVisit(visit: JSONObject) { mutateVisit(true) { repository.cancelVisit(visit.getString("id"), visit.getInt("version")) } }
    private fun mutateVisit(past: Boolean, operation: () -> JSONObject) {
        val current = state.value!!
        val userId = current.session?.userId ?: return
        if (current.bookingBusy) return
        state.value = current.copy(bookingBusy = true, actionError = null, actionNotice = null)
        worker.execute {
            var message: String? = null
            var error: String? = null
            var showPast = past
            try {
                val result = operation()
                message = result.getString("message")
                val appointment = result.getJSONObject("appointment")
                showPast = showPast || appointment.getString("status") != "BOOKED" || !java.time.Instant.parse(appointment.getString("startsAt")).isAfter(java.time.Instant.now())
                repository.clearIdentity("booking"); repository.invalidateClinical()
                runCatching { repository.syncAll() }
            }
            catch (_: IOException) { error = "We could not confirm the result. Check My visits after reconnecting before trying again." }
            catch (failure: ClinicApiException) { error = failure.message }
            catch (_: Exception) { error = "The result could not be checked. Refresh My visits before retrying." }
            Handler(Looper.getMainLooper()).post {
                val latest = state.value!!
                if (latest.session?.userId != userId) return@post
                state.value = latest.copy(bookingBusy = false, actionError = error, actionNotice = message)
                if (error == null) { bookingChoice = ""; bookingKey = ""; showVisits(showPast, keepNotice = true) }
            }
        }
    }
    fun registration(value: Boolean) {
        val current = state.value!!
        if (current.busy || current.register == value) return
        password = ""; passwordVisible = false
        state.value = current.copy(register = value, error = null)
    }
    fun showCare(more: Boolean = false, keepNotice: Boolean = false) {
        val current = state.value!!
        val userId = current.session?.userId ?: return
        val existing = if (more) current.careData?.let { JSONObject(it) } else null
        val cursor = existing?.optString("nextCursor")?.takeIf { it.isNotEmpty() && it != "null" }
        if (more && cursor == null) return
        val generation = ++careGeneration
        state.value = current.copy(careScreen = true, accountScreen = false, visitsScreen = false, selectedDoctor = null, rescheduling = null, careLoading = true, careError = null, careData = existing?.toString(), careNotice = if (keepNotice) current.careNotice else null)
        worker.execute {
            var data: String? = null
            var error: String? = null
            try {
                val loaded = repository.care(cursor)
                if (existing != null) {
                    val items = JSONArray(); val ids = mutableSetOf<String>()
                    for (rows in listOf(existing.getJSONArray("items"), loaded.getJSONArray("items"))) for (index in 0 until rows.length()) {
                        val item = rows.getJSONObject(index); if (ids.add(item.getString("id"))) items.put(item)
                    }
                    loaded.put("items", items)
                }
                data = loaded.toString()
            } catch (_: IOException) { error = "Your prescriptions need a live clinic connection. Reconnect and refresh." }
            catch (failure: ClinicApiException) { error = failure.message }
            catch (_: Exception) { error = "Your prescriptions could not be loaded. Try again." }
            Handler(Looper.getMainLooper()).post {
                val latest = state.value!!
                if (repository.vault.read() == null) { state.value = ConnectedState(loading = false, error = "Your session has ended. Sign in again."); return@post }
                if (generation == careGeneration && latest.session?.userId == userId && latest.careScreen) state.value = latest.copy(careData = data, careLoading = false, careError = error)
            }
        }
    }
    fun requestRefill(prescriptionId: String, note: String) {
        val current = state.value!!
        val userId = current.session?.userId ?: return
        if (current.careBusy || current.careLoading) return
        val choice = "$prescriptionId|${note.trim()}"
        if (refillChoice != choice) { refillChoice = choice; refillKey = UUID.randomUUID().toString() }
        val key = refillKey
        state.value = current.copy(careBusy = true, careError = null, careNotice = null)
        worker.execute {
            var message: String? = null
            var error: String? = null
            try {
                message = repository.requestRefill(prescriptionId, note.trim(), repository.requestIdentity("refill", choice)).getString("message")
                repository.clearIdentity("refill"); repository.invalidateClinical(); runCatching { repository.syncAll() }
            }
            catch (_: IOException) { error = "We could not confirm the result. Refresh My care after reconnecting before sending another request." }
            catch (failure: ClinicApiException) { error = failure.message }
            catch (_: Exception) { error = "The result could not be checked. Refresh My care before retrying." }
            Handler(Looper.getMainLooper()).post {
                val latest = state.value!!
                if (latest.session?.userId != userId) return@post
                state.value = latest.copy(careBusy = false, careNotice = message, careError = error)
                if (error == null) {
                    refillChoice = ""; refillKey = ""; refillDrafts.remove(prescriptionId)
                    if (latest.careScreen) showCare(keepNotice = true)
                }
            }
        }
    }
    fun load() {
        val previous = state.value!!
        state.value = previous.copy(loading = previous.session == null, busy = true, error = null)
        worker.execute {
            val session = repository.vault.read()
            if (session == null) { postHome(ConnectedState(loading = false)); return@execute }
            val cached = repository.cache.read(session.userId)
            try {
                val fresh = repository.refreshHome()
                ConnectedSyncWorker.schedule(getApplication(), session.userId)
                postHome(previous.copy(loading = false, busy = false, session = repository.vault.read(), cached = fresh, error = null, offline = false))
                runCatching { repository.syncAll() }
            } catch (_: IOException) {
                postHome(previous.copy(loading = false, busy = false, session = session, cached = cached, error = "The clinic could not be reached. Saved information may be out of date.", offline = true))
            } catch (error: ClinicApiException) {
                if (error.status in listOf(401, 403)) postHome(ConnectedState(loading = false, error = error.message))
                else postHome(previous.copy(loading = false, busy = false, session = session, cached = cached, error = error.message))
            } catch (_: Exception) { postHome(previous.copy(loading = false, busy = false, session = session, cached = cached, error = "Clinic information could not be loaded. Try again.")) }
        }
    }
    private fun postHome(result: ConnectedState) {
        Handler(Looper.getMainLooper()).post {
            val latest = state.value!!
            if (result.session == null) { state.value = result; return@post }
            if (latest.session != null && latest.session.userId != result.session.userId) return@post
            // A background directory refresh must not reset visit navigation or an in-flight booking.
            state.value = latest.copy(loading = result.loading, busy = result.busy, session = result.session, cached = result.cached, error = result.error, offline = result.offline)
        }
    }
    fun submit() {
        val previous = state.value!!
        if (previous.busy) return
        val enteredEmail = email; val enteredName = name; val enteredPassword = password
        if (enteredEmail.isBlank() || enteredPassword.isBlank() || (previous.register && enteredName.trim().length < 2)) {
            state.value = previous.copy(error = "Enter your email, password and, when registering, your full name."); return
        }
        state.value = previous.copy(busy = true, error = null)
        worker.execute {
            try {
                val session = repository.signIn(enteredEmail, enteredPassword, enteredName.takeIf { previous.register })
                password = ""; passwordVisible = false
                ConnectedSyncWorker.cancel(getApplication())
                ConnectedSyncWorker.schedule(getApplication(), session.userId)
                val cached = runCatching { repository.refreshHome() }.getOrNull()
                val active = repository.vault.read()
                if (active == null) state.postValue(ConnectedState(loading = false, error = "Your session could not be opened. Sign in again."))
                else state.postValue(ConnectedState(loading = false, session = active, cached = cached, offline = cached == null, error = if (cached == null) "Your account is ready. Refresh to load clinic information." else null))
            } catch (error: ClinicApiException) { state.postValue(previous.copy(busy = false, error = error.message)) }
            catch (_: IOException) { state.postValue(previous.copy(busy = false, error = "The clinic could not be reached. Connect to the clinic service and try again.")) }
            catch (_: Exception) { state.postValue(previous.copy(busy = false, error = "Your account could not be opened securely. Try again.")) }
        }
    }
    fun signOut(localOnly: Boolean = false) {
        val previous = state.value!!
        state.value = previous.copy(busy = true, logoutWarning = false, error = null)
        worker.execute {
            try {
                repository.signOut(localOnly); ConnectedSyncWorker.cancel(getApplication()); password = ""; passwordVisible = false; refillDrafts.clear(); refillChoice = ""; refillKey = ""
                state.postValue(ConnectedState(loading = false))
            } catch (_: IOException) { state.postValue(previous.copy(busy = false, logoutWarning = true)) }
            catch (_: Exception) { state.postValue(previous.copy(busy = false, error = "Sign-out could not be completed. Try again.")) }
        }
    }
    fun dismissLogoutWarning() { state.value = state.value!!.copy(logoutWarning = false) }
    fun saveProfile(name: String) = accountAction { repository.profile(name).getString("message") }
    fun changePassword(current: String, next: String) = accountAction(signOut = true) { repository.changePassword(current, next).getString("message") }
    fun revokeOtherSessions() = accountAction { repository.revokeOthers().getString("message") }
    fun recover(code: String, next: String) = accountAction { repository.recover(code, next).getString("message") }
    fun syncNow() = accountAction { repository.syncAll(); "Your records are up to date." }
    fun reminders(value: Boolean) {
        val user = state.value!!.session?.userId ?: return
        ConnectedReminders.setEnabled(getApplication(), user, value)
        if (value) syncNow() else state.value = state.value!!.copy(error = null, accountNotice = "Appointment reminders are off.")
    }
    private fun accountAction(signOut: Boolean = false, action: () -> String) {
        val previous = state.value!!
        if (previous.busy) return
        state.value = previous.copy(busy = true, error = null, accountNotice = null)
        worker.execute {
            try {
                val message = action()
                if (signOut) { repository.signOut(true); ConnectedSyncWorker.cancel(getApplication()) }
                val session = repository.vault.read()
                val savedCache = session?.let { repository.cache.read(it.userId) }
                state.postValue(if (signOut) ConnectedState(loading = false, accountNotice = message) else previous.copy(busy = false, session = session, cached = savedCache, error = null, offline = false, accountNotice = message))
            } catch (e: ClinicApiException) { state.postValue(if (e.status == 401) ConnectedState(loading = false, error = e.message) else previous.copy(busy = false, error = e.message)) }
            catch (_: IOException) { state.postValue(previous.copy(busy = false, error = "The clinic could not be reached. Reconnect and check your account before retrying.")) }
            catch (_: Exception) { state.postValue(previous.copy(busy = false, error = "The change could not be completed. Please try again.")) }
        }
    }
    override fun onCleared() { password = ""; refillDrafts.clear(); worker.shutdown() }
}
