package com.careslot.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/** Small, consistent vector icons. No font downloads or bitmap assets. */
class CareIconView(context: Context, private val kind: String, private val tint: Int) : View(context) {
    private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = tint; style = Paint.Style.STROKE; strokeWidth = 1.7f
        strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.save(); canvas.scale(width / 24f, height / 24f)
        fun line(vararg points: Float) {
            val path = Path(); path.moveTo(points[0], points[1])
            for (i in 2 until points.size step 2) path.lineTo(points[i], points[i + 1])
            canvas.drawPath(path, pen)
        }
        when (kind) {
            "home" -> { line(3f, 10f, 12f, 3f, 21f, 10f); line(5f, 9f, 5f, 21f, 10f, 21f, 10f, 14f, 14f, 14f, 14f, 21f, 19f, 21f, 19f, 9f) }
            "calendar" -> { canvas.drawRoundRect(4f, 5f, 20f, 21f, 3f, 3f, pen); line(4f, 10f, 20f, 10f); line(8f, 3f, 8f, 7f); line(16f, 3f, 16f, 7f); line(8f, 15f, 10f, 17f, 16f, 13f) }
            "plan" -> { canvas.drawRoundRect(5f, 4f, 19f, 22f, 2f, 2f, pen); canvas.drawRoundRect(9f, 2f, 15f, 6f, 1f, 1f, pen); line(9f, 11f, 15f, 11f); line(9f, 15f, 15f, 15f); line(9f, 19f, 12f, 19f) }
            "clinic" -> { canvas.drawRoundRect(3f, 6f, 21f, 21f, 2f, 2f, pen); line(8f, 6f, 8f, 3f, 16f, 3f, 16f, 6f); line(12f, 10f, 12f, 17f); line(8.5f, 13.5f, 15.5f, 13.5f) }
            "clock" -> { canvas.drawCircle(12f, 12f, 9f, pen); line(12f, 7f, 12f, 12f, 16f, 14f) }
            "arrow" -> { line(4f, 12f, 20f, 12f); line(14f, 6f, 20f, 12f, 14f, 18f) }
            "chevron" -> line(9f, 6f, 15f, 12f, 9f, 18f)
            "check" -> line(5f, 12f, 10f, 17f, 20f, 7f)
            "plus" -> { line(12f, 5f, 12f, 19f); line(5f, 12f, 19f, 12f) }
            "person" -> { canvas.drawCircle(12f, 8f, 4f, pen); canvas.drawArc(4f, 14f, 20f, 27f, 180f, 180f, false, pen) }
            "bell" -> { line(5f,17f,7f,14f,7f,9f); canvas.drawArc(7f,4f,17f,14f,180f,180f,false,pen); line(17f,9f,17f,14f,19f,17f,5f,17f); canvas.drawArc(10f,18f,14f,22f,0f,180f,false,pen); line(12f,2f,12f,4f) }
            else -> { // Heart
                val p = Path(); p.moveTo(12f, 21f); p.cubicTo(8f, 17f, 2f, 13f, 3f, 7f)
                p.cubicTo(4f, 1f, 10f, 2f, 12f, 6f); p.cubicTo(15f, 1f, 21f, 2f, 21f, 8f)
                p.cubicTo(21f, 13f, 16f, 18f, 12f, 21f); canvas.drawPath(p, pen)
            }
        }
        canvas.restore()
    }
}
