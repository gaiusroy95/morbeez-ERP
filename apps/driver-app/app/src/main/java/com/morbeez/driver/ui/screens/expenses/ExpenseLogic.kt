package com.morbeez.driver.ui.screens.expenses

import com.morbeez.driver.data.local.ExpenseEntity
import com.morbeez.driver.data.remote.dto.DriverExpenseResponse
import com.morbeez.driver.data.remote.dto.MyExpensesResponse
import java.math.BigDecimal
import java.math.RoundingMode

/** Where an expense stands, as the driver sees it. */
enum class Standing {
    /** On this phone, not sent yet. */
    UNSENT,

    /** Within the driver's authority: nothing to approve. */
    RECORDED,

    /** Beyond it: the owner hasn't decided. */
    WAITING,
    APPROVED,
    REJECTED,
}

/** Why an odometer read at the pump can't be right on this trip. */
enum class OdometerProblem { BELOW_OPENING, BELOW_EARLIER_FILL, ABOVE_RETURN }

/** One line on My Expenses, from this phone or the server. */
data class ExpenseRow(
    val id: String,
    val tripNumber: String?,
    val category: String,
    val amount: String,
    val notes: String?,
    /** ISO instant. */
    val recordedAt: String,
    val odometerKm: Int?,
    val fuelType: String?,
    val fullTank: Boolean?,
    val litres: String?,
    val ratePerLitre: String?,
    val photos: Int,
    val standing: Standing,
    /** The owner's reason, when rejected. */
    val decisionNote: String?,
    /** cash | fastag */
    val paidBy: String = "cash",
)

data class ExpenseTotals(val all: BigDecimal, val fuel: BigDecimal, val other: BigDecimal)

/**
 * Expenses on the road (driver app V1, D6; client design sheet "New
 * Expense", "My Expenses"): the categories, the pump's arithmetic, the
 * odometer's checks — the same the server makes — and where each stands.
 */
object ExpenseLogic {
    /** In the design's order. 'labour' is loading. */
    val CATEGORIES = listOf("fuel", "toll", "parking", "labour", "repair", "other")
    val FUEL_TYPES = listOf("diesel", "petrol", "cng", "electric")

    /** The bill may differ from litres × rate by up to a rupee: the pump rounds. */
    private val PUMP_ROUNDING = BigDecimal.ONE

    /** "65.40" → 65.40; nothing, nonsense, zero or more than [places] decimals → null. */
    fun positive(text: String, places: Int): BigDecimal? =
        text.trim().toBigDecimalOrNull()?.takeIf { it.signum() > 0 && it.stripTrailingZeros().scale() <= places }

    /** A whole-km odometer reading. */
    fun km(text: String): Int? = text.trim().toIntOrNull()?.takeIf { it >= 0 }

    /** litres × rate, to the paisa — what the pump's bill should say. */
    fun fuelTotal(litres: BigDecimal?, rate: BigDecimal?): BigDecimal? =
        if (litres == null || rate == null) null else litres.multiply(rate).setScale(2, RoundingMode.HALF_UP)

    /** The bill matches litres × rate within a rupee. */
    fun billMatches(amount: BigDecimal, litres: BigDecimal, rate: BigDecimal): Boolean =
        amount.subtract(fuelTotal(litres, rate)).abs() <= PUMP_ROUNDING

    /**
     * Why [km] can't be the odometer at a pump on this trip; null when it
     * can: never below where the trip set off or an earlier fill on it, never
     * past what Return read.
     */
    fun odometerProblem(km: Int, openingKm: String?, closingKm: String?, earlierFills: List<Int>): OdometerProblem? {
        val opening = openingKm?.toBigDecimalOrNull()
        val closing = closingKm?.toBigDecimalOrNull()
        return when {
            opening != null && BigDecimal(km) < opening -> OdometerProblem.BELOW_OPENING
            earlierFills.any { km < it } -> OdometerProblem.BELOW_EARLIER_FILL
            closing != null && BigDecimal(km) > closing -> OdometerProblem.ABOVE_RETURN
            else -> null
        }
    }

    fun standingOf(e: ExpenseEntity): Standing = when {
        e.pendingSync -> Standing.UNSENT
        !e.needsApproval -> Standing.RECORDED
        e.decision == "approved" -> Standing.APPROVED
        e.decision == "rejected" -> Standing.REJECTED
        else -> Standing.WAITING
    }

    /** The server's word: recorded | pending | approved | rejected. */
    fun standingOf(status: String): Standing = when (status) {
        "pending" -> Standing.WAITING
        "approved" -> Standing.APPROVED
        "rejected" -> Standing.REJECTED
        else -> Standing.RECORDED
    }

    fun rowOf(e: ExpenseEntity, tripNumber: String?) = ExpenseRow(
        id = e.id,
        tripNumber = tripNumber,
        category = e.category,
        amount = e.amount,
        notes = e.notes,
        recordedAt = e.recordedAt,
        odometerKm = e.odometerKm,
        fuelType = e.fuelType,
        fullTank = e.fullTank,
        litres = e.litres,
        ratePerLitre = e.ratePerLitre,
        photos = e.photos,
        standing = standingOf(e),
        decisionNote = e.decisionNote,
        paidBy = e.paidBy,
    )

    fun rowOf(e: DriverExpenseResponse) = ExpenseRow(
        id = e.id,
        tripNumber = e.tripNumber,
        category = e.category,
        amount = e.amount,
        notes = e.notes,
        recordedAt = e.recordedAt,
        odometerKm = e.fuel?.odometerKm,
        fuelType = e.fuel?.fuelType,
        fullTank = e.fuel?.fullTank,
        litres = e.fuel?.litres,
        ratePerLitre = e.fuel?.ratePerLitre,
        photos = e.photos,
        standing = standingOf(e.status),
        decisionNote = e.decisionNote,
        paidBy = e.paidBy,
    )

    /**
     * All trips: the server's last list, with what this phone knows better —
     * this trip's expenses as they are on the phone (sent or not) — newest first.
     */
    fun allTrips(server: MyExpensesResponse?, thisTrip: List<ExpenseRow>): List<ExpenseRow> {
        val mine = thisTrip.associateBy { it.id }
        val fromServer = server?.items.orEmpty().map { mine[it.id] ?: rowOf(it) }
        val unseen = thisTrip.filter { row -> server?.items.orEmpty().none { it.id == row.id } }
        return (fromServer + unseen).sortedByDescending { it.recordedAt }
    }

    fun totalsOf(rows: List<ExpenseRow>): ExpenseTotals {
        fun sum(xs: List<ExpenseRow>) = xs.mapNotNull { it.amount.toBigDecimalOrNull() }.fold(BigDecimal.ZERO, BigDecimal::add)
        val fuel = sum(rows.filter { it.category == "fuel" })
        val other = sum(rows.filter { it.category != "fuel" })
        return ExpenseTotals(fuel.add(other), fuel, other)
    }

    /** The odometer readings at earlier fills on the trip. */
    fun fillsOf(expenses: List<ExpenseEntity>): List<Int> = expenses.mapNotNull { it.odometerKm }
}
