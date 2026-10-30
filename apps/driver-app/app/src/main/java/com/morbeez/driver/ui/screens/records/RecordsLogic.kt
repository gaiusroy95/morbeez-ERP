package com.morbeez.driver.ui.screens.records

import com.morbeez.driver.data.remote.dto.DriverApprovalResponse
import com.morbeez.driver.data.remote.dto.DriverVehicleResponse
import java.time.LocalDate

/** Something due on the vehicle (the Vehicle screen's Dues). */
data class Due(
    /** document | maintenance */
    val kind: String,
    /** A document's type, or the maintenance's description. */
    val what: String,
    /** overdue | due_soon (maintenance); expired | expiring (documents). */
    val state: String,
    val daysLeft: Int?,
    val kmLeft: Int?,
)

/** The days a list of past trips covers. */
enum class HistoryRange { LAST_30_DAYS, THIS_MONTH, LAST_3_MONTHS }

/**
 * The driver's own records (driver app V1, D6): Approvals filtered by where
 * they stand and what they are, the trip history's dates, what's due on the
 * vehicle.
 */
object RecordsLogic {
    /** pending | approved | rejected, then expense | collection | handover ("all" for every kind). */
    fun approvals(items: List<DriverApprovalResponse>, status: String, kind: String): List<DriverApprovalResponse> =
        items.filter { it.status == status && (kind == "all" || it.kind == kind) }

    fun countOf(items: List<DriverApprovalResponse>, status: String, kind: String): Int = approvals(items, status, kind).size

    /** from–to for the server; null for its default (the last 30 days). */
    fun rangeOf(range: HistoryRange, today: LocalDate): Pair<String, String>? = when (range) {
        HistoryRange.LAST_30_DAYS -> null
        HistoryRange.THIS_MONTH -> today.withDayOfMonth(1).toString() to today.toString()
        HistoryRange.LAST_3_MONTHS -> today.minusMonths(3).plusDays(1).toString() to today.toString()
    }

    /** What needs doing on the vehicle: overdue first, then what's coming, soonest first. */
    fun duesOf(v: DriverVehicleResponse?): List<Due> {
        if (v == null) return emptyList()
        val maintenance = v.maintenance.filter { it.state != "ok" }.map { Due("maintenance", it.description, it.state, it.daysLeft, it.kmLeft) }
        val documents = v.documents.filter { it.state == "expired" || it.state == "expiring" }.map { Due("document", it.docType, it.state, it.daysLeft, null) }
        val urgent = { d: Due -> d.state == "overdue" || d.state == "expired" }
        return (maintenance + documents).sortedWith(compareBy<Due> { !urgent(it) }.thenBy { it.daysLeft ?: Int.MAX_VALUE }.thenBy { it.kmLeft ?: Int.MAX_VALUE })
    }

    /** "+919800000001" → "98000 00001"; anything else as it is. */
    fun phone(value: String?): String? {
        if (value == null) return null
        val digits = value.removePrefix("+91")
        return if (digits.length == 10 && digits.all(Char::isDigit)) "${digits.take(5)} ${digits.drop(5)}" else value
    }
}
