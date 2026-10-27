package com.careslot.app

import android.app.Application
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.SavedStateHandle
import androidx.room.Room
import java.time.LocalDate
import java.util.concurrent.Executors

data class ClinicUiState(val data: ClinicSnapshot = ClinicSnapshot(), val loading: Boolean = true,
    val error: String? = null, val modelAvailable: Boolean = false, val overbooking: Boolean = false,
    val conflicts: Set<String> = emptySet())

class ClinicViewModel(application: Application, private val saved: SavedStateHandle) : AndroidViewModel(application) {
    val state = MutableLiveData(ClinicUiState())
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var database: ClinicDatabase? = null
    private var repository: LocalClinicRepository? = null
    private val settings = application.getSharedPreferences("care_settings", 0)
    private val scheduler by lazy { ReminderScheduler(application) }
    var tab: String get() = saved["tab"] ?: "Home"; set(value) { saved["tab"] = value }
    var filter: String get() = saved["filter"] ?: "Upcoming"; set(value) { saved["filter"] = value }
    var clinicMode: Boolean get() = if(BuildConfig.ROADMAP_PHASE<6) tab=="Clinic" else settings.getBoolean("clinicMode", false); set(value) { settings.edit().putBoolean("clinicMode", value).apply() }
    var patientId: String get() = settings.getString("patientId", "") ?: ""; set(value) { settings.edit().putString("patientId", value).apply() }
    var draftDoctor: String get() = saved["draftDoctor"] ?: ""; set(value) { saved["draftDoctor"] = value }
    var draftDate: String get() = saved["draftDate"] ?: LocalDate.now().plusDays(1).toString(); set(value) { saved["draftDate"] = value }
    var draftTime: String get() = saved["draftTime"] ?: ""; set(value) { saved["draftTime"] = value }
    var draftVisit: String get() = saved["draftVisit"] ?: ""; set(value) { saved["draftVisit"] = value }
    var bookingOpen: Boolean get() = saved["bookingOpen"] ?: false; set(value) { saved["bookingOpen"] = value }
    var draftReminder: Boolean get() = saved["draftReminder"] ?: true; set(value) { saved["draftReminder"] = value }
    var selectedVisit: String get() = saved["selectedVisit"] ?: ""; set(value) { saved["selectedVisit"] = value }

    init { load() }
    fun load() {
        state.value = state.value?.copy(loading = true, error = null)
        worker.execute {
            try {
                if (database == null) database = Room.databaseBuilder(getApplication(), ClinicDatabase::class.java, "care-clinic.db").build()
                val predictor = if (BuildConfig.DEBUG && settings.getBoolean("qaModelFailure", false)) null else runCatching { LocalLogisticPredictor(getApplication()) }.getOrNull()
                if(predictor==null)settings.edit().putBoolean("overbooking",false).apply()
                repository = LocalClinicRepository(getApplication(), database!!, predictor)
                repository!!.importLegacy()
                publish(predictor != null)
            } catch (e: Exception) { state.postValue(ClinicUiState(loading = false, error = "Local records could not be loaded. Your original data has been retained. Retry. (${e.javaClass.simpleName})")) }
        }
    }
    private fun publish(model: Boolean = state.value?.modelAvailable ?: false) {
        val repo = repository ?: return
        val snapshot = repo.snapshot()
        if (snapshot.patients.none { it.id == patientId }) patientId = snapshot.patients.firstOrNull()?.id ?: ""
        if (BuildConfig.ROADMAP_PHASE >= 9) scheduler.sync(snapshot.visits)
        state.postValue(ClinicUiState(snapshot, false, null, model, repo.overbooking, snapshot.visits.filter { repo.conflict(it) }.map { it.id }.toSet()))
    }
    fun perform(action: (LocalClinicRepository) -> OperationResult, done: (OperationResult) -> Unit = {}) {
        worker.execute {
            val result = try { repository?.let(action) ?: OperationResult(false, "Records are still loading.") }
                catch (e: Exception) { OperationResult(false, "The change could not be saved. Please retry. (${e.javaClass.simpleName})") }
            if (result.ok) publish()
            main.post { done(result) }
        }
    }
    fun availableSlots(patient: String, doctor: String, date: String, reminder: Boolean, exclude: String?, done: (List<Pair<String, Boolean>>, Double?) -> Unit) {
        worker.execute {
            val repo = repository
            try {
                val slots = repo?.slots(doctor, date)?.map { time ->
                    val planned=ReminderPolicy.planned(reminder,true,date,time)
                    val risk=repo.estimate(patient,date,planned)
                    time to (repo.slotError(patient,doctor,date,time,risk,exclude)==null)
                } ?: emptyList()
                main.post { done(slots, null) }
            } catch (_: Exception) { main.post { done(emptyList(), null) } }
        }
    }
    fun forceModelFailure(value: Boolean) { settings.edit().putBoolean("qaModelFailure", value).apply(); load() }
    fun qaReminder(visit: VisitRecord, done: (OperationResult) -> Unit) { done(scheduler.qa(visit)) }
    fun notificationsAllowed() = scheduler.allowed()
    fun clearDraft() { bookingOpen = false; draftVisit = ""; draftTime = "" }
    override fun onCleared() { worker.execute { database?.close() }; worker.shutdown() }
}
