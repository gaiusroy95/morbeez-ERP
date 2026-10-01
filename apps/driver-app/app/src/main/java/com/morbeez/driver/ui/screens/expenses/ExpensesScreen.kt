package com.morbeez.driver.ui.screens.expenses

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.Stat
import com.morbeez.driver.ui.theme.Fresh

private val CATEGORIES = listOf("fuel" to "Fuel", "toll" to "Toll", "labour" to "Labour", "other" to "Other")

/** Trip Summary: what this trip has spent so far, and adding a new expense (DRV.19). */
@Composable
fun ExpensesScreen(tripId: String, onBack: (() -> Unit)? = null, viewModel: ExpensesViewModel = hiltViewModel()) {
    LaunchedEffect(tripId) { viewModel.load(tripId) }
    val expenses by viewModel.expenses.collectAsStateWithLifecycle()
    var category by remember { mutableStateOf(CATEGORIES.first().first) }
    var amountText by remember { mutableStateOf("") }
    val amount = amountText.toDoubleOrNull()
    val total = expenses.sumOf { it.amount.toString().toDoubleOrNull() ?: 0.0 }

    FieldScreen(
        title = "Trip expenses",
        eyebrow = "Trip summary",
        onBack = onBack,
        headerExtra = {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Stat("Spent this trip", "₹%,.0f".format(total), onDark = true, modifier = Modifier.weight(1f))
                Stat("Entries", "${expenses.size}", onDark = true, modifier = Modifier.weight(1f))
            }
        },
    ) {
        FieldCard {
            Eyebrow("Recorded", modifier = Modifier.padding(bottom = 6.dp))
            if (expenses.isEmpty()) {
                Text("Nothing yet.", style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted, modifier = Modifier.padding(vertical = 8.dp))
            }
            expenses.forEachIndexed { i, expense ->
                if (i > 0) HorizontalDivider(color = Fresh.border)
                Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(Fresh.surface2), contentAlignment = Alignment.Center) {
                        GlyphIcon(if (expense.category == "fuel") Glyph.Fuel else Glyph.Rupee, Fresh.primary, size = 18.dp)
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(
                        expense.category.replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.titleSmall,
                        color = Fresh.ink,
                        modifier = Modifier.weight(1f),
                    )
                    Text("₹${expense.amount}", style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
                }
            }
        }

        FieldCard {
            Eyebrow("Add an expense", modifier = Modifier.padding(bottom = 12.dp))
            ChoiceTiles(CATEGORIES, category) { category = it }
            FreshTextField(
                value = amountText,
                onValueChange = { amountText = it },
                label = "Amount (₹)",
                keyboardType = KeyboardType.Decimal,
                leading = Glyph.Rupee,
                modifier = Modifier.padding(top = 12.dp),
            )
            PrimaryAction(
                text = "Add expense",
                onClick = {
                    if (amount != null && amount > 0) {
                        viewModel.recordExpense(tripId, category, amount, null)
                        amountText = ""
                    }
                },
                enabled = amount != null && amount > 0,
                glyph = Glyph.Check,
                modifier = Modifier.padding(top = 14.dp),
            )
        }
    }
}
