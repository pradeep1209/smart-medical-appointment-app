package com.careslot.app

import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import java.util.concurrent.Executors

/** One task: find, verify and remember this patient's clinic server. Uses the existing CareSlot tokens. */
class ClinicConnectionActivity : ComponentActivity() {
    private val ui by lazy { UiKit(this) }
    private val connection by lazy { ClinicConnection(this) }
    private val worker = Executors.newSingleThreadExecutor()
    private var busy = false
    private var searched = false
    private var found = emptyList<ClinicServer>()
    private var error: String? = null
    private var manual = ""
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = CareTokens.canvas; window.navigationBarColor = Color.WHITE
        manual = savedInstanceState?.getString("manual") ?: ""
        render()
        if (BuildConfig.DEBUG) search()
    }
    override fun onSaveInstanceState(outState: Bundle) { outState.putString("manual", manual); super.onSaveInstanceState(outState) }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
    private fun <T> work(task: () -> T, done: (T) -> Unit) {
        if (busy) return
        busy = true; error = null; render()
        worker.execute {
            try { val result = task(); runOnUiThread { if (!isDestroyed && !isFinishing) { busy = false; done(result); render() } } }
            catch (failure: Exception) { runOnUiThread { if (!isDestroyed && !isFinishing) { busy = false; error = failure.message ?: "The connection could not be checked. Try again."; render() } } }
        }
    }
    private fun search() = work({ connection.discover() }) { found = it; searched = true }
    private fun confirm(candidate: ClinicServer) {
        val current = connection.saved()
        if (SessionVault(this).read() != null && current != null && current.id != candidate.id) {
            error = "Sign out of your patient account before choosing another clinic server."; render(); return
        }
        AlertDialog.Builder(this).setTitle("Connect to ${candidate.name}?")
            .setMessage("${candidate.url}\n\nServer identity: ${candidate.id.take(12)}\n\nCheck that this is your clinic computer. CareSlot will remember it when its network address changes.")
            .setNegativeButton("Back", null)
            .setPositiveButton("Connect") { _, _ -> work({
                val fresh = connection.inspect(candidate.url)
                if (fresh.id != candidate.id || fresh.publicKey != candidate.publicKey) throw java.io.IOException("The server identity changed. Search again.")
                connection.choose(fresh)
            }) { setResult(RESULT_OK); finish() } }.show()
    }
    private fun render() {
        val root = ui.column().apply { setBackgroundColor(CareTokens.canvas) }
        val header = ui.row().apply { setPadding(ui.dp(24), ui.dp(16), ui.dp(24), ui.dp(8)); addView(ui.brand()) }
        root.addView(header)
        val content = ui.column().apply { setPadding(ui.dp(24), ui.dp(8), ui.dp(24), ui.dp(28)) }
        root.addView(ScrollView(this).apply { isFillViewport = true; addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        content.addView(ui.button("Back", 2) { finish() })
        ui.heading(content, "Clinic connection", "Find your care team on this network.")
        connection.saved()?.let { saved ->
            ui.card(content) {
                addView(ui.text("Selected clinic server", 12f, CareTokens.muted))
                addView(ui.text(saved.name, 19f, bold = true))
                addView(ui.text(saved.url, 13f, CareTokens.muted))
                addView(ui.text("Saved identity · ${saved.id.take(12)}", 12f, CareTokens.muted))
                addView(ui.button("Check connection", 1) { work({ connection.resolve() }) { Toast.makeText(this@ClinicConnectionActivity, "Clinic connection verified", Toast.LENGTH_LONG).show() } }.apply { isEnabled = !busy })
            }
        }
        content.addView(ui.text("Use shared Wi-Fi, your phone's hotspot or your computer's hotspot. Keep the clinic computer awake with CareSlot running.", 14f, CareTokens.muted))
        error?.let { content.addView(ui.text(it, 14f, CareTokens.danger).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }) }
        if (busy) {
            ui.gap(content, 16); content.addView(ProgressBar(this).apply { contentDescription = "Checking clinic connection" })
            content.addView(ui.text("Checking nearby clinic servers…", 14f, CareTokens.muted).apply { gravity = Gravity.CENTER })
        }
        if (BuildConfig.DEBUG) {
            content.addView(ui.button(if (searched) "Search again" else "Find my clinic") { search() }.apply { isEnabled = !busy })
            ui.gap(content, 18)
            content.addView(ui.text("Nearby clinics", 17f, bold = true))
            if (searched && found.isEmpty() && !busy) content.addView(ui.text("No clinic server found. Check the server and firewall, then search again or enter its address below. Some networks block discovery or device communication.", 14f, CareTokens.muted))
            found.forEach { server ->
                ui.rule(content)
                content.addView(ui.text(server.name, 16f, bold = true))
                content.addView(ui.text(server.url, 13f, CareTokens.muted))
                content.addView(ui.button(if (connection.saved()?.id == server.id) "Reconnect" else "Choose clinic", 1) { confirm(server) }.apply { isEnabled = !busy })
            }
            ui.gap(content, 20); ui.rule(content)
        }
        content.addView(ui.text("Enter an address", 17f, bold = true))
        content.addView(ui.text("Use the address of the computer running CareSlot, even when the phone provides the hotspot.", 13f, CareTokens.muted))
        val address = ui.input(content, "Clinic server address", manual).apply {
            hint = if (BuildConfig.DEBUG) "http://192.168.1.20:3001" else "https://clinic.example"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            isEnabled = !busy
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { manual = s?.toString() ?: "" }
                override fun afterTextChanged(s: android.text.Editable?) {}
            })
        }
        fun checkAddress() {
            val value = address.text.toString()
            (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(address.windowToken, 0)
            work({ connection.inspect(value) }) { confirm(it) }
        }
        address.setOnEditorActionListener { _, action, _ -> if (action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) { checkAddress(); true } else false }
        content.addView(ui.button("Check address", 1) { checkAddress() }.apply { isEnabled = !busy })
        setContentView(root)
    }
}
