package com.morbeez.driver.ui.screens.cash

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.theme.Fresh

private val METHODS = listOf("cash" to R.string.method_cash, "upi" to R.string.method_upi, "bank_transfer" to R.string.method_bank, "cheque" to R.string.method_cheque)

@Composable
fun CashCollectionScreen(
    tripId: String,
    stopId: String,
    onDone: () -> Unit,
    onBack: (() -> Unit)? = null,
    viewModel: CashCollectionViewModel = hiltViewModel(),
) {
    var amountText by remember { mutableStateOf("") }
    var method by remember { mutableStateOf(METHODS.first().first) }
    var notes by remember { mutableStateOf("") }
    val amount = amountText.toDoubleOrNull()

    FieldScreen(
        title = stringResource(R.string.collect_payment),
        eyebrow = stringResource(R.string.kind_delivery),
        onBack = onBack,
        bottomBar = {
            PrimaryAction(
                text = if (amount != null && amount > 0) stringResource(R.string.record_amount, amountText) else stringResource(R.string.record_collection),
                onClick = { viewModel.recordCollection(tripId, stopId, amount ?: 0.0, method, notes.ifBlank { null }, onDone) },
                enabled = amount != null && amount > 0,
                glyph = Glyph.Check,
            )
        },
    ) {
        // The amount is the point of this screen, so it's typed big.
        FieldCard {
            Eyebrow(stringResource(R.string.amount_received))
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                Text("₹", style = MaterialTheme.typography.displaySmall, color = Fresh.inkFaint)
                BasicTextField(
                    value = amountText,
                    onValueChange = { v -> if (v.count { it == '.' } <= 1 && v.all { it.isDigit() || it == '.' }) amountText = v },
                    textStyle = MaterialTheme.typography.displayMedium.copy(color = Fresh.ink),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    cursorBrush = SolidColor(Fresh.primary),
                    decorationBox = { inner ->
                        if (amountText.isEmpty()) Text("0", style = MaterialTheme.typography.displayMedium, color = Fresh.borderStrong)
                        inner()
                    },
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
        }

        FieldCard {
            Eyebrow(stringResource(R.string.how_they_paid), modifier = Modifier.padding(bottom = 12.dp))
            ChoiceTiles(METHODS.map { (k, label) -> k to stringResource(label) }, method) { method = it }
        }

        FreshTextField(value = notes, onValueChange = { notes = it }, label = stringResource(R.string.notes_optional), singleLine = false)
    }
}
