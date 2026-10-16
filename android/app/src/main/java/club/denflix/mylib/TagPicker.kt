package club.denflix.mylib

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.widget.NestedScrollView
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipDrawable
import com.google.android.material.chip.ChipGroup

/** Splits "Christmas, Signed" into ["Christmas", "Signed"]. */
fun parseTags(value: String?): List<String> =
    value.orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() && it != "null" }.distinctBy { it.lowercase() }

/**
 * Bottom sheet with the shared tag list as tappable chips (several can be on),
 * plus a box to create a new tag. Calls onSave with the chosen tags, or
 * onCancel if it's closed without saving.
 */
object TagPicker {
    fun show(
        context: Context,
        title: String,
        allTags: List<String>,
        initial: List<String>,
        message: String? = null,
        saveLabel: String = "Save tags",
        onCancel: () -> Unit = {},
        onSave: (List<String>) -> Unit,
    ) {
        val dialog = BottomSheetDialog(context)
        val dp = context.resources.displayMetrics.density
        val scroll = NestedScrollView(context)
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * dp).toInt(), (16 * dp).toInt(), (20 * dp).toInt(), (20 * dp).toInt())
        }
        scroll.addView(root, ViewGroup.LayoutParams(-1, -2))

        root.addView(TextView(context).apply {
            text = title
            textSize = 20f
            setTypeface(android.graphics.Typeface.SERIF, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(context, R.color.text))
        })
        if (message != null) root.addView(TextView(context).apply {
            text = message
            setTextColor(ContextCompat.getColor(context, R.color.muted))
            setPadding(0, (4 * dp).toInt(), 0, 0)
        })

        val group = ChipGroup(context).apply { isSingleSelection = false }
        val empty = TextView(context).apply {
            text = "No tags yet — create one below."
            setTextColor(ContextCompat.getColor(context, R.color.muted))
        }
        fun addChip(name: String, checked: Boolean) {
            if ((0 until group.childCount).any { (group.getChildAt(it) as Chip).text.toString().equals(name, true) }) {
                (0 until group.childCount).map { group.getChildAt(it) as Chip }
                    .first { it.text.toString().equals(name, true) }.isChecked = true
                return
            }
            val chip = Chip(context).apply {
                setChipDrawable(ChipDrawable.createFromAttributes(context, null, 0, com.google.android.material.R.style.Widget_Material3_Chip_Filter))
                text = name
                isCheckable = true
                isChecked = checked
            }
            group.addView(chip)
            empty.visibility = View.GONE
        }
        val initialLower = initial.map { it.lowercase() }
        (allTags + initial.filter { t -> allTags.none { it.equals(t, true) } }).forEach { addChip(it, it.lowercase() in initialLower) }
        if (group.childCount == 0) root.addView(empty)
        root.addView(group, LinearLayout.LayoutParams(-1, -2).apply { topMargin = (12 * dp).toInt() })

        // New tag
        val row = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        val input = EditText(context).apply {
            hint = "New tag"
            setSingleLine()
            imeOptions = EditorInfo.IME_ACTION_DONE
        }
        val addButton = MaterialButton(context, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply { text = "Add" }
        fun addTyped() {
            val name = input.text.toString().trim().replace(Regex("\\s+"), " ")
            if (name.isNotEmpty()) addChip(name, true)
            input.setText("")
        }
        addButton.setOnClickListener { addTyped() }
        input.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_DONE) { addTyped(); true } else false }
        row.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(addButton, LinearLayout.LayoutParams(-2, -2).apply { marginStart = (8 * dp).toInt() })
        root.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = (12 * dp).toInt() })

        // Save / Cancel
        var saved = false
        val buttons = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.END }
        val cancel = MaterialButton(context, null, com.google.android.material.R.attr.borderlessButtonStyle).apply { text = "Cancel" }
        val save = MaterialButton(context).apply { text = saveLabel }
        cancel.setOnClickListener { dialog.dismiss() }
        save.setOnClickListener {
            addTyped() // a typed-but-not-added tag counts too
            saved = true
            val chosen = (0 until group.childCount).map { group.getChildAt(it) as Chip }.filter { it.isChecked }.map { it.text.toString() }
            dialog.dismiss()
            onSave(chosen)
        }
        buttons.addView(cancel)
        buttons.addView(save, LinearLayout.LayoutParams(-2, -2).apply { marginStart = (8 * dp).toInt() })
        root.addView(buttons, LinearLayout.LayoutParams(-1, -2).apply { topMargin = (16 * dp).toInt() })

        dialog.setContentView(scroll)
        dialog.behavior.state = BottomSheetBehavior.STATE_EXPANDED
        dialog.behavior.skipCollapsed = true
        dialog.setOnDismissListener { if (!saved) onCancel() }
        dialog.show()
    }
}
