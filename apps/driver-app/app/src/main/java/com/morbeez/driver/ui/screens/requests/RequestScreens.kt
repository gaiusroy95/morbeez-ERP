package com.morbeez.driver.ui.screens.requests

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.ChoiceTiles
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.FieldCard
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.components.rememberLeaveGuard
import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.theme.Fresh

@Composable
fun RequestScreen(onBack: () -> Unit, onSent: () -> Unit, viewModel: RequestViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    RequestContent(state, onBack, onPin = viewModel::pinHere) { form -> viewModel.send(form, onSent) }
}

/** The kind's name, for Approvals too. */
@Composable
fun requestKindLabel(kind: String): String = stringResource(
    when (kind) {
        "advance" -> R.string.req_advance
        "new_customer" -> R.string.req_new_customer
        else -> R.string.req_credit_limit
    },
)

/**
 * Ask the office (driver app D10): an advance, a customer met on the road,
 * a higher credit limit for a customer on the trip — with why. It's on the
 * phone at once and sent when there's signal; the owner decides it in their
 * Approvals, and the driver sees the answer on theirs. Nothing is promised
 * until then.
 */
@Composable
internal fun RequestContent(
    state: RequestUiState,
    onBack: () -> Unit,
    onPin: ((Double, Double) -> Unit) -> Unit,
    initial: RequestForm = RequestForm(),
    initialReview: Boolean = false,
    onSend: (RequestForm) -> Unit,
) {
    var kind by rememberSaveable { mutableStateOf(initial.kind) }
    var amount by rememberSaveable { mutableStateOf(initial.amount) }
    var reason by rememberSaveable { mutableStateOf(initial.reason) }
    var customerId by rememberSaveable { mutableStateOf(initial.customerId) }
    var name by rememberSaveable { mutableStateOf(initial.name) }
    var phone by rememberSaveable { mutableStateOf(initial.phone) }
    var place by rememberSaveable { mutableStateOf(initial.place) }
    var address by rememberSaveable { mutableStateOf(initial.address) }
    var latitude by rememberSaveable { mutableStateOf(initial.latitude) }
    var longitude by rememberSaveable { mutableStateOf(initial.longitude) }
    var reviewing by rememberSaveable { mutableStateOf(initialReview) }
    val form = RequestForm(kind, amount, reason, customerId, name, phone, place, address, latitude, longitude)
    val ready = RequestLogic.ready(form)
    val dirty = amount.isNotBlank() || reason.isNotBlank() || name.isNotBlank() || phone.isNotBlank() || customerId != null
    val leave = rememberLeaveGuard(dirty && initial == RequestForm(), onBack)
    val decimal = { s: String -> s.filter { c -> c.isDigit() || c == '.' }.take(10) }

    FieldScreen(
        title = stringResource(R.string.req_title),
        eyebrow = stringResource(R.string.req_eyebrow),
        onBack = leave,
        bottomBar = { PrimaryAction(stringResource(R.string.req_send), onClick = { reviewing = true }, enabled = ready, glyph = Glyph.Send) },
    ) {
        Eyebrow(stringResource(R.string.req_what))
        ChoiceTiles(RequestLogic.KINDS.map { it to requestKindLabel(it) }, kind) { kind = it }
        FieldCard {
            when (kind) {
                "advance" -> {
                    Text(stringResource(R.string.req_advance_hint), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
                    FreshTextField(amount, { amount = decimal(it) }, stringResource(R.string.amount_rupees), keyboardType = KeyboardType.Decimal, prefix = "₹", modifier = Modifier.padding(top = 12.dp))
                }
                "credit_limit" -> {
                    Text(stringResource(R.string.req_limit_hint), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
                    if (state.customers.isEmpty()) {
                        Callout(stringResource(R.string.req_no_customers), Tone.Attention)
                    } else {
                        Eyebrow(stringResource(R.string.req_customer), modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
                        ChoiceTiles(state.customers.map { it.id to it.name }, customerId ?: "") { customerId = it }
                    }
                    FreshTextField(amount, { amount = decimal(it) }, stringResource(R.string.req_limit_amount), keyboardType = KeyboardType.Decimal, prefix = "₹", modifier = Modifier.padding(top = 12.dp))
                }
                else -> {
                    Text(stringResource(R.string.req_customer_hint), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
                    FreshTextField(name, { name = it.take(120) }, stringResource(R.string.req_shop_name), modifier = Modifier.padding(top = 12.dp))
                    FreshTextField(phone, { phone = it.filter { c -> c.isDigit() || c == ' ' || c == '+' }.take(16) }, stringResource(R.string.req_shop_phone), keyboardType = KeyboardType.Phone, leading = Glyph.Phone, modifier = Modifier.padding(top = 10.dp))
                    if (phone.isNotBlank() && RequestLogic.phoneOf(phone) == null) {
                        Text(stringResource(R.string.req_phone_ten), style = MaterialTheme.typography.bodySmall, color = Fresh.critical, modifier = Modifier.padding(top = 4.dp))
                    }
                    FreshTextField(place, { place = it.take(120) }, stringResource(R.string.req_shop_place), modifier = Modifier.padding(top = 10.dp))
                    FreshTextField(address, { address = it.take(300) }, stringResource(R.string.req_shop_address), singleLine = false, modifier = Modifier.padding(top = 10.dp))
                    Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        GlyphIcon(Glyph.Pin, if (latitude != null) Fresh.primary else Fresh.inkMuted, size = 20.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            when {
                                latitude != null && longitude != null -> stringResource(R.string.req_pinned, String.format(java.util.Locale.ROOT, "%.5f, %.5f", latitude, longitude))
                                state.pinning -> stringResource(R.string.req_pinning)
                                state.pinFailed -> stringResource(R.string.req_pin_failed)
                                else -> stringResource(R.string.req_pin_hint)
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (state.pinFailed && latitude == null) Fresh.critical else Fresh.inkMuted,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    SecondaryAction(
                        stringResource(if (latitude != null) R.string.req_pin_again else R.string.req_pin_here),
                        onClick = { onPin { lat, lng -> latitude = lat; longitude = lng } },
                        enabled = !state.pinning,
                        glyph = Glyph.Pin,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
        }
        FreshTextField(reason, { reason = it.take(500) }, stringResource(R.string.req_reason), singleLine = false)
        Callout(stringResource(R.string.req_owner_decides), Tone.Active)
        Spacer(Modifier.height(4.dp))
    }

    if (reviewing && ready) {
        val lines = buildList {
            add(requestKindLabel(kind))
            when (kind) {
                "advance" -> add(stringResource(R.string.rupees, DayLogic.rupees(RequestLogic.amountOf(form)!!.toPlainString())))
                "credit_limit" -> {
                    state.customers.firstOrNull { it.id == customerId }?.let { add(it.name) }
                    add(stringResource(R.string.req_limit_to, DayLogic.rupees(RequestLogic.amountOf(form)!!.toPlainString())))
                }
                else -> {
                    add(name.trim())
                    RequestLogic.phoneOf(phone)?.let { add(it) }
                    listOf(place, address).map { it.trim() }.filter { it.isNotEmpty() }.joinToString(", ").ifEmpty { null }?.let { add(it) }
                    if (latitude != null) add(stringResource(R.string.req_with_pin))
                }
            }
            add(reason.trim())
        }
        AlertDialog(
            onDismissRequest = { reviewing = false },
            containerColor = Fresh.surface,
            title = { Text(stringResource(R.string.req_review_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    lines.forEach { Text(it, style = MaterialTheme.typography.bodyLarge, color = Fresh.ink) }
                    Text(stringResource(R.string.req_review_note), style = MaterialTheme.typography.bodySmall, color = Fresh.inkMuted, modifier = Modifier.padding(top = 6.dp))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    reviewing = false
                    onSend(form)
                }) { Text(stringResource(R.string.req_send), color = Fresh.primary) }
            },
            dismissButton = { TextButton(onClick = { reviewing = false }) { Text(stringResource(R.string.edit), color = Fresh.inkMuted) } },
        )
    }
}
