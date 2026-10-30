package com.morbeez.driver.ui.screens.backhaul

import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.ui.screens.collect.AmountProblem
import com.morbeez.driver.ui.screens.collect.CollectionsLogic
import java.math.BigDecimal

/** Where a backhaul is, for the driver. */
enum class BackhaulStage { OFFERED, RUNNING, TO_PAY, PAID, SKIPPED, CANCELLED }

/** A backhaul's steps once accepted, in order (client spec §17). */
val BACKHAUL_STEPS = listOf("pickup_reached", "loaded", "drop_reached", "completed")

/** Cash, UPI or an account transfer — no cheques for a backhaul. */
val BACKHAUL_METHODS = listOf("cash", "upi", "bank_transfer")

/** Why the next step can't be taken yet. */
enum class StepBlock { STOPS_LEFT, LOAD_PHOTO, DROP_PHOTO }

/** What's missing from a backhaul the driver adds. */
enum class AddProblem { PICKUP, DROP, RENT }

/**
 * Backhaul (driver app V1, D5; client spec §16–§17), kept apart from
 * Android so it's unit-tested: where each backhaul is, the step to take
 * next and what it needs first, which one the Dashboard shows, and what
 * holds the Return and the handover — the same rules the server applies.
 */
object BackhaulLogic {
    fun stageOf(b: BackhaulEntity): BackhaulStage = when (b.status) {
        "offered" -> BackhaulStage.OFFERED
        "accepted" -> BackhaulStage.RUNNING
        "skipped" -> BackhaulStage.SKIPPED
        "cancelled" -> BackhaulStage.CANCELLED
        else -> if (b.paidAt == null) BackhaulStage.TO_PAY else BackhaulStage.PAID
    }

    fun stepAt(b: BackhaulEntity, step: String): String? = when (step) {
        "pickup_reached" -> b.pickupReachedAt
        "loaded" -> b.loadedAt
        "drop_reached" -> b.dropReachedAt
        "completed" -> b.completedAt
        else -> null
    }

    /** The step to take next; null when it isn't under way. */
    fun nextStepOf(b: BackhaulEntity): String? =
        if (b.status != "accepted") null else BACKHAUL_STEPS.firstOrNull { stepAt(b, it) == null }

    /** What the next step needs first: the deliveries done (it runs on the way back), the load or the drop photographed. */
    fun blockOf(b: BackhaulEntity, stopsLeft: Int): StepBlock? = when (nextStepOf(b)) {
        "pickup_reached" -> if (stopsLeft > 0) StepBlock.STOPS_LEFT else null
        "loaded" -> if (b.loadPhotos == 0) StepBlock.LOAD_PHOTO else null
        "completed" -> if (b.dropPhotos == 0) StepBlock.DROP_PHOTO else null
        else -> null
    }

    /** The one to work on now: one under way, then one to be paid, then an offer to answer. */
    fun currentOf(backhauls: List<BackhaulEntity>): BackhaulEntity? =
        backhauls.firstOrNull { it.status == "accepted" }
            ?: backhauls.firstOrNull { stageOf(it) == BackhaulStage.TO_PAY }
            ?: backhauls.firstOrNull { it.status == "offered" }

    /** The vehicle isn't back while an offer waits for an answer or a backhaul is under way. */
    fun holdsReturn(backhauls: List<BackhaulEntity>): Boolean = backhauls.any { it.status == "offered" || it.status == "accepted" }

    /** …and the driver doesn't hand over until the rent is recorded. */
    fun holdsHandover(backhauls: List<BackhaulEntity>): Boolean =
        holdsReturn(backhauls) || backhauls.any { stageOf(it) == BackhaulStage.TO_PAY }

    /** Rent received in cash: part of the cash to hand over. */
    fun cashOf(backhauls: List<BackhaulEntity>): BigDecimal =
        backhauls.filter { it.paymentMethod == "cash" }.mapNotNull { it.amountReceived?.toBigDecimalOrNull() }.fold(BigDecimal.ZERO, BigDecimal::add)

    /** Never more than the rent; less is recorded as it is (the owner hears). */
    fun amountProblem(text: String, rent: String): AmountProblem? = CollectionsLogic.amountProblem(text, rent.toBigDecimalOrNull())

    fun addProblem(pickup: String, drop: String, rent: String): AddProblem? = when {
        pickup.trim().length < 2 -> AddProblem.PICKUP
        drop.trim().length < 2 -> AddProblem.DROP
        CollectionsLogic.amountProblem(rent, null) != null -> AddProblem.RENT
        else -> null
    }
}
