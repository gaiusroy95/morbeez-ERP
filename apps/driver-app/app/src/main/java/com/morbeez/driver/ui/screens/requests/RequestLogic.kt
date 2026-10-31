package com.morbeez.driver.ui.screens.requests

import com.morbeez.driver.ui.screens.expenses.ExpenseLogic
import java.math.BigDecimal

/** A customer on the trip's deliveries, whose credit limit the driver may ask about. */
data class TripCustomer(val id: String, val name: String)

/** A request recorded on this phone the office hasn't had yet — or refused (Sync says why). */
data class UnsentRequest(
    val key: String,
    val kind: String,
    val amount: String?,
    /** A credit limit's customer, or the new customer's name. */
    val customerName: String?,
    val reason: String,
    val createdAt: Long,
    val refused: Boolean,
)

/** What the driver fills in on Ask the office, before it's checked. */
data class RequestForm(
    val kind: String = "advance",
    val amount: String = "",
    val reason: String = "",
    val customerId: String? = null,
    val name: String = "",
    val phone: String = "",
    val place: String = "",
    val address: String = "",
    val latitude: Double? = null,
    val longitude: Double? = null,
)

/**
 * What a driver asks the office for from the road (driver app D10): an
 * advance, a new customer met on the route, a higher credit limit for a
 * customer on the trip. Each carries what the office needs to decide it, and
 * why.
 */
object RequestLogic {
    val KINDS = listOf("advance", "new_customer", "credit_limit")

    const val MAX_ADVANCE = 100_000

    /** The amount, when it's a usable one: above zero for an advance, zero or more for a limit. */
    fun amountOf(form: RequestForm): BigDecimal? {
        val text = form.amount.trim()
        if (form.kind == "credit_limit") {
            if (text.isEmpty()) return null
            return text.toBigDecimalOrNull()?.takeIf { it.signum() >= 0 && it.scale() <= 2 && it <= BigDecimal(10_000_000) }
        }
        return ExpenseLogic.positive(text, 2)?.takeIf { it <= BigDecimal(MAX_ADVANCE) }
    }

    /** "98000 00011" → "9800000011"; null when it can't be a phone number. */
    fun phoneOf(text: String): String? {
        val digits = text.filter(Char::isDigit)
        return when {
            text.isBlank() -> null
            digits.length == 10 -> digits
            digits.length == 12 && digits.startsWith("91") -> digits.drop(2)
            else -> null
        }
    }

    /** Ready to send: the kind's own fields, and a reason of a few words. */
    fun ready(form: RequestForm): Boolean {
        if (form.reason.trim().length < 3) return false
        return when (form.kind) {
            "advance" -> amountOf(form) != null
            "credit_limit" -> form.customerId != null && amountOf(form) != null
            "new_customer" -> form.name.trim().length >= 2 && (form.phone.isBlank() || phoneOf(form.phone) != null)
            else -> false
        }
    }
}
