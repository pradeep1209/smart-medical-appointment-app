package com.careslot.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class ConnectedSession(val userId: String, val accessToken: String, val refreshToken: String, val userJson: String, val serverId: String? = null)

/** Session secrets are encrypted by a non-exportable Android Keystore key. */
class SessionVault(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("care_connected_session", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(): ConnectedSession? = synchronized(lock) {
        val encrypted = prefs.getString("encrypted", null) ?: return@synchronized null
        try {
            val parts = encrypted.split(":")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))) }
            val json = JSONObject(String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8))
            ConnectedSession(json.getString("userId"), json.getString("accessToken"), json.getString("refreshToken"), json.getString("userJson"), json.optString("serverId").takeIf { it.isNotBlank() && it != "null" })
        } catch (_: Exception) { prefs.edit().remove("encrypted").commit(); null }
    }
    fun save(session: ConnectedSession) = synchronized(lock) {
        val json = JSONObject().put("userId", session.userId).put("accessToken", session.accessToken).put("refreshToken", session.refreshToken).put("userJson", session.userJson)
        session.serverId?.let { json.put("serverId", it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val value = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        check(prefs.edit().putString("encrypted", value).commit()) { "Session could not be saved securely." }
    }
    fun clear(userId: String) = synchronized(lock) { if (read()?.userId == userId) prefs.edit().remove("encrypted").commit() else false }
    fun seal(value: String): String = synchronized(lock) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    fun open(value: String): String = synchronized(lock) {
        val parts = value.split(":")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP))) }
        String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }
    companion object { val lock = Any(); private const val ALIAS = "careslot.connected.session.v1" }
}
