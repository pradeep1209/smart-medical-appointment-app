package com.careslot.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ClinicApiException(val status: Int, override val message: String) : Exception(message)
class ConnectedRepository(private val context: Context) {
    val vault = SessionVault(context)
    val cache = ConnectedDatabase.get(context).cache()
    private val clinical = ConnectedDatabase.get(context).clinical()
    private fun clearAccount(userId: String) { cache.delete(userId); clinical.delete(userId); ConnectedReminders.clear(context, userId); MedicationReminders.clear(context, userId); java.io.File(context.cacheDir, "exports/$userId").deleteRecursively() }
    private fun request(path: String, body: JSONObject? = null, access: String? = null): JSONObject {
        val connection = URL(BuildConfig.API_BASE_URL.trimEnd('/')+path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = if (body == null) "GET" else "POST"
            connection.connectTimeout = 10000; connection.readTimeout = 15000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            access?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            // A service outage must preserve the signed-in account and its cached records.
            // Do not surface infrastructure error text from the server to patients.
            if (status in 500..599) throw IOException("The clinic service is temporarily unavailable.")
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val json = runCatching { JSONObject(text) }.getOrElse { throw IOException("The clinic service did not return a valid response.") }
            if (status !in 200..299) {
                val message = when (val value = json.opt("message")) { is JSONArray -> (0 until value.length()).joinToString(" ") { value.getString(it) }; is String -> value; else -> "The clinic could not complete this request." }
                throw ClinicApiException(status, message)
            }
            return json
        } finally { connection.disconnect() }
    }
    private fun parseSession(json: JSONObject): ConnectedSession {
        val user = json.getJSONObject("user")
        return ConnectedSession(user.getString("id"), json.getString("accessToken"), json.getString("refreshToken"), user.toString())
    }
    fun signIn(email: String, password: String, name: String? = null): ConnectedSession {
        val data = JSONObject().put("email", email.trim()).put("password", password)
        if (name != null) data.put("displayName", name.trim())
        val response = request(if (name == null) "/auth/mobile/login" else "/auth/mobile/register", data)
        val session = parseSession(response)
        synchronized(SessionVault.lock) {
            vault.read()?.takeIf { it.userId != session.userId }?.let { clearAccount(it.userId) }
            vault.save(session)
        }
        return session
    }
    private fun authorized(path: String, body: JSONObject? = null): JSONObject {
        val userId = vault.read()?.userId ?: throw ClinicApiException(401, "Sign in to continue.")
        try { return authorizedInternal(path, body) }
        catch (error: ClinicApiException) {
            if (error.status == 401) synchronized(SessionVault.lock) { if (vault.read()?.userId == userId) { vault.clear(userId); clearAccount(userId) } }
            throw error
        }
    }
    private fun authorizedInternal(path: String, body: JSONObject? = null): JSONObject {
        val original = vault.read() ?: throw ClinicApiException(401, "Sign in to continue.")
        return try { request(path, body, original.accessToken) }
        catch (error: ClinicApiException) {
            if (error.status != 401) throw error
            val current = synchronized(SessionVault.lock) {
                val saved = vault.read() ?: throw ClinicApiException(401, "Sign in again.")
                if (saved.userId != original.userId) throw ClinicApiException(401, "Your account has changed. Sign in again.")
                if (saved.accessToken != original.accessToken) saved
                else parseSession(request("/auth/mobile/refresh", JSONObject().put("refreshToken", saved.refreshToken))).also {
                    if (it.userId != saved.userId) throw ClinicApiException(403, "Your account could not be refreshed securely. Sign in again.")
                    vault.save(it)
                }
            }
            request(path, body, current.accessToken)
        }
    }
    private fun clinicalRead(kind: String, path: String, cursor: String?): JSONObject {
        val userId = vault.read()?.userId ?: throw ClinicApiException(401, "Sign in again.")
        try {
            val data = authorized(path)
            synchronized(SessionVault.lock) {
                if (vault.read()?.userId != userId) throw ClinicApiException(401, "Your account has changed.")
                if (cursor == null) clinical.save(ClinicalCache(userId, kind, vault.seal(data.toString())))
            }
            return data
        } catch (error: IOException) {
            if (cursor != null) throw error
            return synchronized(SessionVault.lock) {
                if (vault.read()?.userId != userId) throw ClinicApiException(401, "Sign in again.")
                val saved = clinical.read(userId, kind) ?: throw error
                JSONObject(vault.open(saved.encrypted)).put("_savedAt", saved.savedAt).put("nextCursor", JSONObject.NULL)
            }
        } catch (error: ClinicApiException) {
            if (error.status == 401) synchronized(SessionVault.lock) { vault.clear(userId); clearAccount(userId) }
            throw error
        }
    }
    fun requestIdentity(kind: String, choice: String): String = synchronized(SessionVault.lock) {
        val userId = vault.read()?.userId ?: throw ClinicApiException(401, "Sign in again.")
        val old = clinical.read(userId, "identity-$kind")?.let { JSONObject(vault.open(it.encrypted)) }
        if (old?.optString("choice") == choice) old.getString("key") else {
            val key = java.util.UUID.randomUUID().toString()
            clinical.save(ClinicalCache(userId, "identity-$kind", vault.seal(JSONObject().put("choice", choice).put("key", key).toString())))
            key
        }
    }
    fun clearIdentity(kind: String) { vault.read()?.let { clinical.deleteKind(it.userId, "identity-$kind") } }
    fun invalidateClinical() { vault.read()?.let { user -> for (kind in listOf("visits-false", "visits-true", "care")) clinical.deleteKind(user.userId, kind) } }
    fun refreshHome(): ConnectedCache {
        val userId = vault.read()?.userId ?: throw ClinicApiException(401, "Sign in to continue.")
        try {
            val response = authorized("/patient/home")
            if (response.getJSONObject("user").getString("id") != userId) throw ClinicApiException(403, "The clinic returned an unexpected account. Sign in again.")
            return synchronized(SessionVault.lock) {
                if (vault.read()?.userId != userId) throw ClinicApiException(401, "Your account has changed.")
                vault.read()?.let { vault.save(it.copy(userJson = response.getJSONObject("user").toString())) }
                ConnectedCache(userId, response.toString()).also { cache.save(it) }
            }
        } catch (error: ClinicApiException) {
            if (error.status in listOf(401, 403)) synchronized(SessionVault.lock) { vault.clear(userId); clearAccount(userId) }
            throw error
        }
    }
    fun availableTimes(clinicId: String, doctorId: String, date: String, excludeId: String? = null): JSONObject {
        return authorized("/patient/clinics/$clinicId/doctors/$doctorId/slots?date=$date" + (excludeId?.let { "&excludeAppointmentId=$it" } ?: ""))
    }
    fun visits(past: Boolean, cursor: String? = null): JSONObject = clinicalRead("visits-$past", "/patient/appointments?view=${if (past) "past" else "upcoming"}" + (cursor?.let { "&cursor=$it" } ?: ""), cursor)
    fun care(cursor: String? = null): JSONObject = clinicalRead("care", "/patient/care" + (cursor?.let { "?cursor=$it" } ?: ""), cursor)
    fun reminderVisits(): JSONArray {
        val items = JSONArray(); var cursor: String? = null
        repeat(200) {
            val page = authorized("/patient/appointments?view=upcoming" + (cursor?.let { "&cursor=$it" } ?: ""))
            val rows = page.getJSONArray("items"); for (i in 0 until rows.length()) items.put(rows.getJSONObject(i))
            cursor = page.optString("nextCursor").takeIf { it.isNotEmpty() && it != "null" }
            if (cursor == null) return items
        }
        throw IOException("Visit synchronization is incomplete.")
    }
    fun syncReminders() { val userId = vault.read()?.userId ?: return; ConnectedReminders.reconcile(context, userId, reminderVisits()) }
    fun syncAll() {
        refreshHome()
        for (page in listOf(visits(false), visits(true), care())) if (page.has("_savedAt")) throw IOException("Some saved records could not be refreshed.")
        syncReminders()
        MedicationReminders.reconcile(context, vault.read()!!.userId, medicationPlans())
    }
    fun experience(): JSONObject = authorized("/experience")
    fun experienceRecord(path: String): JSONObject = authorized(path)
    fun medicationPlans(): JSONArray = authorized("/experience/medication-plans").getJSONArray("plans")
    fun experienceAction(path: String, body: JSONObject): JSONObject = authorized(path, body)
    fun profile(name: String): JSONObject {
        val result = authorized("/account/profile", JSONObject().put("displayName", name.trim()))
        synchronized(SessionVault.lock) { vault.read()?.let { if (it.userId == result.getJSONObject("user").getString("id")) vault.save(it.copy(userJson = result.getJSONObject("user").toString())) } }
        return result
    }
    fun changePassword(current: String, next: String): JSONObject = authorized("/account/password", JSONObject().put("currentPassword", current).put("newPassword", next))
    fun revokeOthers(): JSONObject = authorized("/account/sessions/revoke-others", JSONObject())
    fun recover(code: String, next: String): JSONObject = request("/auth/recover", JSONObject().put("code", code.trim()).put("newPassword", next))
    fun requestRefill(id: String, note: String, key: String): JSONObject = authorized("/patient/prescriptions/$id/refills", JSONObject().put("patientNote", note).put("requestKey", key))
    fun book(clinicId: String, doctorId: String, start: String, key: String): JSONObject = authorized("/patient/appointments", JSONObject().put("clinicId", clinicId).put("doctorId", doctorId).put("startsAt", start).put("requestKey", key))
    fun moveVisit(id: String, version: Int, start: String): JSONObject = authorized("/patient/appointments/$id/reschedule", JSONObject().put("version", version).put("startsAt", start))
    fun cancelVisit(id: String, version: Int): JSONObject = authorized("/patient/appointments/$id/cancel", JSONObject().put("version", version))
    fun signOut(localOnly: Boolean = false) {
        val session = vault.read() ?: return
        if (!localOnly) try { authorized("/auth/logout", JSONObject()) } catch (error: ClinicApiException) { if (error.status != 401) throw error }
        synchronized(SessionVault.lock) { vault.clear(session.userId); clearAccount(session.userId) }
    }
}
