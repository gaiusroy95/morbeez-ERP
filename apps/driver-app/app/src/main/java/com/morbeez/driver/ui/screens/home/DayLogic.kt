package com.morbeez.driver.ui.screens.home

import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.ui.screens.backhaul.BackhaulLogic
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** The driver's day on the Dashboard: Start → Pick → Deliver → Summary → Complete. */
enum class DayStep { START, PICK, DELIVER, SUMMARY, COMPLETE }

/** The one thing the Dashboard asks the driver to do now. */
sealed interface NextAction {
    /** The owner hasn't planned a trip for today. */
    data object NoTrip : NextAction
    data object StartDay : NextAction
    data class GoTo(val stop: TripStopEntity) : NextAction
    /** Every stop done: a backhaul to answer, run or be paid for (D5). */
    data class Backhaul(val backhaul: BackhaulEntity) : NextAction
    /** Every stop done, back at base: record the closing KM (D4). */
    data object Return : NextAction
    /** Every stop done: hand over the cash and submit. */
    data object Handover : NextAction
    data object AwaitingOwner : NextAction
    data class OnHold(val note: String?) : NextAction
}

enum class Greeting { MORNING, AFTERNOON, EVENING }

/** Why an opening KM can't be used. */
enum class KmProblem { REQUIRED, NOT_A_NUMBER, ONE_DECIMAL, BELOW_LAST }

/** Distance and time to a stop, from the phone's position. */
data class Eta(val km: Double, val minutes: Int)

/** Done and planned, of one kind of stop. */
data class Progress(val done: Int, val total: Int)

/**
 * The Dashboard's reasoning, kept apart from Android so it's unit-tested on
 * the JVM: which step of the day it is, what to do next, how far the next
 * stop is, and the figures as the driver reads them.
 */
object DayLogic {
    /** Straight line × this ≈ the road (Driver app V1 plan: no paid routing in V1). */
    const val ROAD_FACTOR = 1.3

    /** Average speed between stops, km/h. */
    const val AVERAGE_SPEED_KMH = 30.0

    fun isDone(stop: TripStopEntity) = stop.status != "pending"

    /** The stop to do next: the first not done, in the owner's visiting order. */
    fun nextStop(stops: List<TripStopEntity>): TripStopEntity? =
        stops.filterNot(::isDone).minByOrNull { it.sequenceNumber }

    fun progressOf(stops: List<TripStopEntity>, stopType: String): Progress {
        val ofType = stops.filter { it.stopType == stopType }
        return Progress(ofType.count(::isDone), ofType.size)
    }

    /** Where the day is; null with no trip. */
    fun stepOf(trip: TripEntity?, stops: List<TripStopEntity>): DayStep? = when (trip?.status) {
        null -> null
        "planned" -> DayStep.START
        "in_progress" -> when {
            stops.any { it.stopType == "pickup" && !isDone(it) } -> DayStep.PICK
            stops.any { it.stopType == "delivery" && !isDone(it) } -> DayStep.DELIVER
            else -> DayStep.SUMMARY
        }
        else -> DayStep.COMPLETE
    }

    /** After the last stop: the backhaul (answered, run, paid), then Return, then the handover. */
    fun nextActionOf(trip: TripEntity?, stops: List<TripStopEntity>, backhauls: List<BackhaulEntity> = emptyList()): NextAction = when (trip?.status) {
        null -> NextAction.NoTrip
        "planned" -> NextAction.StartDay
        "in_progress" -> nextStop(stops)?.let { NextAction.GoTo(it) }
            ?: BackhaulLogic.currentOf(backhauls)?.let { NextAction.Backhaul(it) }
            ?: if (trip.openingKm != null && trip.closingKm == null) NextAction.Return else NextAction.Handover
        "on_hold" -> NextAction.OnHold(trip.reviewNote)
        else -> NextAction.AwaitingOwner
    }

    /** Great-circle distance, km. */
    fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val r = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * r * asin(sqrt(a))
    }

    /** By road, roughly: straight line × [ROAD_FACTOR] at [AVERAGE_SPEED_KMH]; null without both positions. */
    fun etaTo(fromLat: Double?, fromLng: Double?, stop: TripStopEntity): Eta? {
        if (fromLat == null || fromLng == null) return null
        val toLat = stop.partyLatitude ?: return null
        val toLng = stop.partyLongitude ?: return null
        val km = haversineKm(fromLat, fromLng, toLat, toLng) * ROAD_FACTOR
        return Eta(km, max(1, (km / AVERAGE_SPEED_KMH * 60).roundToInt()))
    }

    /** "3.2 km"; under a kilometre, "0.4 km". */
    fun kmLabel(km: Double): String = BigDecimal(km).setScale(1, RoundingMode.HALF_UP).toPlainString()

    fun greetingAt(hour: Int): Greeting = when {
        hour < 12 -> Greeting.MORNING
        hour < 17 -> Greeting.AFTERNOON
        else -> Greeting.EVENING
    }

    /** What's wrong with [input] as the opening KM; null when it can be used. */
    fun openingKmProblem(input: String, lastKm: Double?): KmProblem? {
        val text = input.trim()
        if (text.isEmpty()) return KmProblem.REQUIRED
        val km = text.toBigDecimalOrNull() ?: return KmProblem.NOT_A_NUMBER
        if (km.signum() < 0) return KmProblem.NOT_A_NUMBER
        if (km.stripTrailingZeros().scale() > 1) return KmProblem.ONE_DECIMAL
        if (lastKm != null && km.toDouble() < lastKm) return KmProblem.BELOW_LAST
        return null
    }

    /**
     * Indian digit grouping: "152000.00" → "1,52,000"; paise only when
     * there are any ("1850.50" → "1,850.50"). Unreadable input comes back as it is.
     */
    fun rupees(amount: String?): String {
        val value = amount?.trim()?.toBigDecimalOrNull() ?: return amount.orEmpty()
        val scaled = value.setScale(2, RoundingMode.HALF_UP)
        val whole = scaled.setScale(0, RoundingMode.DOWN)
        val paise = scaled.subtract(whole).abs()
        val grouped = groupIndian(whole.abs().toPlainString())
        val sign = if (scaled.signum() < 0) "-" else ""
        return if (paise.signum() == 0) "$sign$grouped" else "$sign$grouped.${paise.movePointRight(2).toInt().toString().padStart(2, '0')}"
    }

    /** A quantity as read: "1895.000" → "1,895"; "12.500" → "12.5". */
    fun quantity(value: String?): String {
        val number = value?.trim()?.toBigDecimalOrNull() ?: return value.orEmpty()
        val plain = number.stripTrailingZeros().let { if (it.scale() < 0) it.setScale(0) else it }.toPlainString()
        val negative = plain.startsWith("-")
        val digits = plain.removePrefix("-")
        val whole = digits.substringBefore('.')
        val fraction = digits.substringAfter('.', "")
        return (if (negative) "-" else "") + groupIndian(whole) + if (fraction.isEmpty()) "" else ".$fraction"
    }

    /** "12345678" → "1,23,45,678": the last three digits, then pairs. */
    fun groupIndian(digits: String): String {
        if (digits.length <= 3) return digits
        val head = digits.dropLast(3)
        val pairs = head.reversed().chunked(2).joinToString(",").reversed()
        return "$pairs,${digits.takeLast(3)}"
    }

    /** Two letters for an avatar: "Raju Driver" → "RD"; "Raju" → "R". */
    fun initialsOf(name: String?): String =
        name.orEmpty().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1).uppercase() }
}
