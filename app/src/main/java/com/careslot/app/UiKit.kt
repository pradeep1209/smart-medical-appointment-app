package com.careslot.app

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.*
import android.os.Build
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*

object CareTokens {
    val ink = Color.rgb(28,61,49)
    val teal = Color.rgb(44,112,87)
    val muted = Color.rgb(96,113,103)
    val canvas = Color.rgb(246,249,247)
    val sage = Color.rgb(234,243,237)
    val border = Color.rgb(225,233,227)
    val control = Color.rgb(200,214,204)
    val danger = Color.rgb(158,63,52)
}

class UiKit(private val context: Context) {
    private val family by lazy { context.resources.getFont(R.font.dm_sans) }
    fun face(weight: Int = 400): Typeface = if (Build.VERSION.SDK_INT >= 28) Typeface.create(family, weight, false) else Typeface.create(family, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
    fun dp(n: Int) = (n * context.resources.displayMetrics.density).toInt()
    fun column() = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    fun row() = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
    fun text(value: String, size: Float = 15f, color: Int = CareTokens.ink, bold: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color)
        typeface = face(if (bold) 600 else 400)
        setLineSpacing(dp(2).toFloat(), 1.05f); setPadding(0, dp(3), 0, dp(3))
    }
    fun shape(fill: Int, radius: Int = 16, stroke: Boolean = false) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat(); if (stroke) setStroke(dp(1), CareTokens.border)
    }
    fun button(label: String, style: Int = 0, action: () -> Unit) = Button(context).apply {
        text = label; isAllCaps = false; textSize = 14f; letterSpacing = 0f
        typeface = face(600)
        setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(CareTokens.muted, if (style == 0) Color.WHITE else if (style == 3) CareTokens.danger else CareTokens.ink)))
        val backgrounds = StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), shape(CareTokens.border, 14))
            addState(intArrayOf(), shape(if (style == 0) CareTokens.ink else if (style == 1 || style == 3) Color.WHITE else Color.TRANSPARENT, 14, style == 1 || style == 3))
        }
        background = RippleDrawable(ColorStateList.valueOf(Color.argb(30,8,126,120)), backgrounds, null)
        stateListAnimator = null; minHeight = dp(52); minimumHeight = dp(52)
        setPadding(dp(16),dp(12),dp(16),dp(12)); layoutParams = LinearLayout.LayoutParams(-1,-2).apply { topMargin = dp(12) }
        setOnClickListener { action() }
    }
    fun gap(parent: LinearLayout, height: Int = 12) { parent.addView(View(context), LinearLayout.LayoutParams(1,dp(height))) }
    fun icon(kind: String, color: Int = CareTokens.teal, size: Int = 22) = CareIconView(context,kind,color).apply {
        layoutParams = LinearLayout.LayoutParams(dp(size),dp(size)); importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    fun badge(label: String, fill: Int = CareTokens.sage, color: Int = CareTokens.teal) = text(label,12f,color,true).apply {
        background = shape(fill,8); setPadding(dp(10),dp(5),dp(10),dp(5)); layoutParams = LinearLayout.LayoutParams(-2,-2)
    }
    fun rule(parent: LinearLayout) { parent.addView(View(context).apply { setBackgroundColor(CareTokens.border) }, LinearLayout.LayoutParams(-1,dp(1)).apply { topMargin=dp(14); bottomMargin=dp(14) }) }
    fun card(parent: LinearLayout, tint: Int = Color.WHITE, body: LinearLayout.() -> Unit) {
        val box = column().apply {
            setPadding(dp(20),dp(20),dp(20),dp(20)); background=shape(tint,18,true)
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(16) }
        }; box.body(); parent.addView(box)
    }
    fun input(parent: LinearLayout, label: String, value: String = "", numeric: Boolean = false): EditText {
        val field = EditText(context).apply {
            id=View.generateViewId(); setText(value); hint=label; textSize=16f; setSingleLine(true)
            setTextColor(CareTokens.ink); setHintTextColor(CareTokens.muted)
            fun fieldShape(fill:Int,stroke:Int,width:Int=1)=GradientDrawable().apply{setColor(fill);cornerRadius=dp(12).toFloat();setStroke(dp(width),stroke)}
            background=StateListDrawable().apply {
                addState(intArrayOf(-android.R.attr.state_enabled),fieldShape(CareTokens.canvas,CareTokens.border))
                addState(intArrayOf(android.R.attr.state_focused),fieldShape(Color.WHITE,CareTokens.teal,2))
                addState(intArrayOf(),fieldShape(Color.WHITE,CareTokens.control))
            }
            setPadding(dp(14),dp(14),dp(14),dp(14)); minHeight=dp(54)
            layoutParams=LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(7); bottomMargin=dp(18) }
            inputType=if(numeric) InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            typeface=face()
        }
        parent.addView(text(label,13f,CareTokens.ink,true).apply { labelFor=field.id })
        parent.addView(field); return field
    }
    fun heading(parent: LinearLayout, title: String, subtitle: String) {
        parent.addView(text(title,30f,CareTokens.ink,true).apply { typeface=face(700); letterSpacing=-.025f }); gap(parent,6)
        parent.addView(text(subtitle,14f,CareTokens.muted)); gap(parent,24)
    }
    fun avatar(name: String, size: Int = 46) = text(name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1) }.uppercase(), size*.32f, CareTokens.ink, true).apply {
        val tints=intArrayOf(Color.rgb(232,241,235),Color.rgb(237,240,245),Color.rgb(245,239,229))
        gravity=Gravity.CENTER; background=shape(tints[(name.hashCode() and Int.MAX_VALUE)%tints.size],size)
        setPadding(0,0,0,0); layoutParams=LinearLayout.LayoutParams(dp(size),dp(size)); importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    fun brand() = row().apply {
        addView(icon("calendar",CareTokens.ink,26)); addView(text("CareSlot",24f,CareTokens.ink,true).apply { typeface=face(700); letterSpacing=-.035f },LinearLayout.LayoutParams(-2,-2).apply { marginStart=dp(10) })
    }
    fun navItem(label: String, kind: String, selected: Boolean, action: () -> Unit) = column().apply {
        gravity=Gravity.CENTER; minimumHeight=dp(68); setPadding(dp(4),dp(6),dp(4),dp(6))
        isSelected=selected; isClickable=true; isFocusable=true; contentDescription=label
        background=RippleDrawable(ColorStateList.valueOf(CareTokens.sage),null,null)
        addView(android.widget.FrameLayout(context).apply {
            background=shape(if(selected) CareTokens.sage else Color.TRANSPARENT,20)
            addView(icon(kind,if(selected) CareTokens.ink else CareTokens.muted,22),android.widget.FrameLayout.LayoutParams(dp(22),dp(22),Gravity.CENTER))
        },LinearLayout.LayoutParams(dp(48),dp(32)))
        addView(text(label,11f,if(selected) CareTokens.ink else CareTokens.muted,selected).apply { importantForAccessibility=View.IMPORTANT_FOR_ACCESSIBILITY_NO; gravity=Gravity.CENTER; maxLines=1 })
        setOnClickListener { action() }
        accessibilityDelegate=object:View.AccessibilityDelegate(){ override fun onInitializeAccessibilityNodeInfo(host:View,info:android.view.accessibility.AccessibilityNodeInfo){super.onInitializeAccessibilityNodeInfo(host,info);info.className="android.widget.Button";info.isSelected=selected} }
    }
    fun patientNavigation(active: String, select: (String) -> Unit) = column().apply {
        addView(View(context).apply { setBackgroundColor(CareTokens.border) }, LinearLayout.LayoutParams(-1, dp(1)))
        addView(row().apply {
            setBackgroundColor(Color.WHITE); setPadding(dp(6),dp(4),dp(6),dp(6))
            for ((id,label,icon) in listOf(Triple("clinic","Clinic","clinic"),Triple("visits","Visits","calendar"),Triple("care","Care","plan"),Triple("inbox","Inbox","bell"),Triple("account","Account","person"))) {
                addView(navItem(label,icon,id==active) { select(id) },LinearLayout.LayoutParams(0,-2,1f))
            }
        })
    }
    fun careSections(active: String, select: (String) -> Unit) = row().apply {
        background=shape(CareTokens.sage,12); setPadding(dp(3),dp(3),dp(3),dp(3))
        layoutParams=LinearLayout.LayoutParams(-1,-2).apply { bottomMargin=dp(20) }
        for ((id,label) in listOf("prescriptions" to "Medicines", "medication" to "Reminders", "documents" to "Documents")) {
            addView(text(label,12f,if(id==active) CareTokens.ink else CareTokens.muted,id==active).apply {
                gravity=Gravity.CENTER; minHeight=dp(48); setPadding(dp(4),dp(8),dp(4),dp(8))
                background=RippleDrawable(ColorStateList.valueOf(CareTokens.sage),shape(if(id==active) Color.WHITE else Color.TRANSPARENT,9),null)
                isSelected=id==active; isClickable=true; isFocusable=true; contentDescription=label
                setOnClickListener { select(id) }
                accessibilityDelegate=object:View.AccessibilityDelegate(){ override fun onInitializeAccessibilityNodeInfo(host:View,info:android.view.accessibility.AccessibilityNodeInfo){super.onInitializeAccessibilityNodeInfo(host,info);info.className="android.widget.Button";info.isSelected=id==active} }
            },LinearLayout.LayoutParams(0,-2,1f))
        }
    }
}
