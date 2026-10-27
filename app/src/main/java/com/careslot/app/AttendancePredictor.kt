package com.careslot.app

import android.content.Context
import org.json.JSONObject
import kotlin.math.exp

data class BookingFeatures(val leadDays: Int, val priorAppointments: Int, val priorMissed: Int, val reminderPlanned: Boolean) {
    init {
        require(leadDays in 0..60)
        require(priorAppointments in 0..20)
        require(priorMissed in 0..priorAppointments)
    }
}

interface AttendancePredictor {
    val version: String get() = "custom"
    fun noShowProbability(features: BookingFeatures): Double
}

/** Exact logistic inference; learned parameters and scaling ship in assets. */
class LocalLogisticPredictor internal constructor(private val model: JSONObject) : AttendancePredictor {
    constructor(context: Context) : this(JSONObject(context.assets.open("attendance_model.json").bufferedReader().use { it.readText() }))
    override val version = model.getString("version")
    private val mean = DoubleArray(4) { model.getJSONArray("mean").getDouble(it) }
    private val scale = DoubleArray(4) { model.getJSONArray("scale").getDouble(it) }
    private val weights = DoubleArray(4) { model.getJSONArray("weights").getDouble(it) }
    private val intercept = model.getDouble("intercept")
    init {
        require(version.isNotBlank()) { "Missing model version" }
        require(model.getString("positive_class") == "no_show") { "Unsupported model class" }
        val expected = listOf("lead_days", "smoothed_prior_noshow_rate", "prior_appointments", "reminder_planned")
        val features = model.getJSONArray("features")
        require(features.length() == expected.size && expected.indices.all { features.getString(it) == expected[it] }) { "Unsupported feature schema" }
        require(listOf("mean", "scale", "weights").all { model.getJSONArray(it).length() == 4 }) { "Invalid model dimensions" }
        require(intercept.isFinite() && mean.all { it.isFinite() } && weights.all { it.isFinite() } && scale.all { it.isFinite() && it > 0 }) { "Invalid model parameters" }
        require(model.getString("history_smoothing") == "(prior_missed + 1) / (prior_appointments + 4)") { "Unsupported history smoothing" }
    }
    override fun noShowProbability(features: BookingFeatures): Double {
        val values = doubleArrayOf(
            features.leadDays.toDouble(),
            (features.priorMissed + 1.0) / (features.priorAppointments + 4.0),
            features.priorAppointments.toDouble(),
            if (features.reminderPlanned) 1.0 else 0.0
        )
        var logit = intercept
        for (i in values.indices) {
            logit += (values[i] - mean[i]) / scale[i] * weights[i]
        }
        return 1.0 / (1.0 + exp(-logit.coerceIn(-30.0, 30.0)))
    }
}
