package com.morbeez.driver.ui.screens.farm

import com.morbeez.driver.data.local.Decision
import com.morbeez.driver.data.local.FarmDraft
import com.morbeez.driver.data.local.FarmLineDraft
import com.morbeez.driver.data.remote.dto.CrewMemberResponse
import com.morbeez.driver.data.remote.dto.CrewOptionResponse
import com.morbeez.driver.data.remote.dto.FarmLineRequest
import com.morbeez.driver.data.remote.dto.FarmStopLineResponse
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
import java.math.BigDecimal
import java.math.RoundingMode

/** The reasons a product is refused at a farm (client spec §6), as the server names them. */
val REJECT_REASONS = listOf("quality_issue", "quantity_short", "damaged", "farmer_not_ready", "other")

/** What's wrong with a line, if anything. */
enum class LineProblem { UNDECIDED, NO_QUANTITY, BAD_NUMBER, NO_SACKS, NO_KG_PER_BAG, NO_REASON }

/** The Load Complete checklist (design sheet screen 7). */
data class Readiness(val decided: Boolean, val weighed: Boolean, val crew: Boolean, val photo: Boolean) {
    val ready get() = decided && weighed && crew && photo
}

/**
 * The farmer stop's rules, kept apart from Android so they're unit-tested:
 * every product accepted (weighed, or sacks × kg a bag) or rejected with a
 * reason; the crew chosen and the load photographed when anything was
 * loaded; then what's sent to the server, and what the phone shows until it
 * hears back.
 */
object FarmLogic {
    /** Bags of a set weight only make sense for what's sold by the kilo. */
    fun bagsApply(item: StopItemResponse) = item.uom == "kg"

    /** A typed number: up to 3 decimals, not negative; null when blank or unreadable. */
    fun number(text: String): BigDecimal? {
        val n = text.trim().toBigDecimalOrNull() ?: return null
        if (n.signum() < 0 || n.stripTrailingZeros().scale() > 3) return null
        return n
    }

    /** One line per product, in the order the farm supplies them; what was typed for each is kept. */
    fun withItems(draft: FarmDraft, items: List<StopItemResponse>): FarmDraft {
        val have = draft.lines.associateBy { it.productId }
        return draft.copy(lines = items.map { have[it.productId] ?: FarmLineDraft(it.productId) })
    }

    /** What an accepted line loads, in the product's unit; null when it can't be worked out yet. */
    fun quantityOf(line: FarmLineDraft, item: StopItemResponse, byBags: Boolean): BigDecimal? {
        if (line.decision != Decision.ACCEPTED) return null
        if (byBags && bagsApply(item)) {
            val sacks = line.sacks.trim().toIntOrNull()?.takeIf { it > 0 } ?: return null
            val each = number(line.kgPerBag)?.takeIf { it.signum() > 0 } ?: return null
            return each.multiply(BigDecimal(sacks)).setScale(3, RoundingMode.HALF_UP)
        }
        return number(line.weight)?.takeIf { it.signum() > 0 }
    }

    fun problemOf(line: FarmLineDraft, item: StopItemResponse, byBags: Boolean): LineProblem? = when (line.decision) {
        null -> LineProblem.UNDECIDED
        Decision.REJECTED -> if (line.reason == null) LineProblem.NO_REASON else null
        Decision.ACCEPTED -> when {
            byBags && bagsApply(item) && line.sacks.trim().toIntOrNull()?.takeIf { it > 0 } == null -> LineProblem.NO_SACKS
            byBags && bagsApply(item) && number(line.kgPerBag)?.takeIf { it.signum() > 0 } == null -> LineProblem.NO_KG_PER_BAG
            !(byBags && bagsApply(item)) && line.weight.isBlank() -> LineProblem.NO_QUANTITY
            !(byBags && bagsApply(item)) && number(line.weight)?.takeIf { it.signum() > 0 } == null -> LineProblem.BAD_NUMBER
            line.sacks.isNotBlank() && line.sacks.trim().toIntOrNull()?.takeIf { it >= 0 } == null -> LineProblem.BAD_NUMBER
            else -> null
        }
    }

    fun anyAccepted(draft: FarmDraft) = draft.lines.any { it.decision == Decision.ACCEPTED }

    /** Who loaded: the packer, when one person did both. */
    fun loaderOf(draft: FarmDraft): String? = if (draft.samePerson) draft.packerId else draft.loaderId

    fun readinessOf(draft: FarmDraft, items: List<StopItemResponse>): Readiness {
        val byId = items.associateBy { it.productId }
        val lines = draft.lines.filter { byId.containsKey(it.productId) }
        val decided = lines.size == items.size && lines.all { it.decision != null }
        val weighed = decided && lines.all { problemOf(it, byId.getValue(it.productId), draft.byBags) == null }
        val loads = anyAccepted(draft)
        return Readiness(
            decided = decided,
            weighed = weighed,
            crew = !loads || (draft.packerId != null && loaderOf(draft) != null),
            photo = !loads || draft.loadPhotos > 0,
        )
    }

    /** The kilos loaded (grams counted too): what the crew is credited with. */
    fun loadedKg(draft: FarmDraft, items: List<StopItemResponse>): BigDecimal {
        val byId = items.associateBy { it.productId }
        return draft.lines.fold(BigDecimal.ZERO) { sum, line ->
            val item = byId[line.productId] ?: return@fold sum
            val q = quantityOf(line, item, draft.byBags) ?: return@fold sum
            when (item.uom) {
                "kg" -> sum + q
                "g" -> sum + q.divide(BigDecimal(1000), 3, RoundingMode.HALF_UP)
                else -> sum
            }
        }.setScale(3, RoundingMode.HALF_UP)
    }

    /** What's sent at hold-to-complete: every product, and the crew. */
    fun requestOf(draft: FarmDraft, items: List<StopItemResponse>): List<FarmLineRequest> {
        val byId = items.associateBy { it.productId }
        return draft.lines.mapNotNull { line ->
            val item = byId[line.productId] ?: return@mapNotNull null
            when (line.decision) {
                Decision.REJECTED -> FarmLineRequest(line.productId, "rejected", reason = line.reason, note = line.note.trim().ifBlank { null })
                Decision.ACCEPTED -> if (draft.byBags && bagsApply(item)) {
                    FarmLineRequest(
                        line.productId,
                        "accepted",
                        measuredBy = "bags",
                        sacks = line.sacks.trim().toIntOrNull(),
                        kgPerBag = number(line.kgPerBag)?.toDouble(),
                        note = line.note.trim().ifBlank { null },
                    )
                } else {
                    FarmLineRequest(
                        line.productId,
                        "accepted",
                        netQuantity = number(line.weight)?.toDouble(),
                        measuredBy = "weight",
                        sacks = line.sacks.trim().toIntOrNull(),
                        note = line.note.trim().ifBlank { null },
                    )
                }
                null -> null
            }
        }
    }

    /** The completed stop as this phone shows it until the server's own copy arrives. */
    fun outcomeOf(draft: FarmDraft, items: List<StopItemResponse>, crew: List<CrewOptionResponse>): FarmStopOutcomeResponse {
        val byId = items.associateBy { it.productId }
        fun member(id: String?) = crew.firstOrNull { it.employeeId == id }?.let { CrewMemberResponse(it.employeeId, it.name) }
        return FarmStopOutcomeResponse(
            packer = member(draft.packerId),
            loader = member(loaderOf(draft)),
            lines = draft.lines.mapNotNull { line ->
                val item = byId[line.productId] ?: return@mapNotNull null
                val bags = draft.byBags && bagsApply(item)
                FarmStopLineResponse(
                    productId = line.productId,
                    productName = item.productName,
                    uom = item.uom,
                    outcome = if (line.decision == Decision.ACCEPTED) "accepted" else "rejected",
                    acceptedQuantity = (quantityOf(line, item, draft.byBags) ?: BigDecimal.ZERO).setScale(3, RoundingMode.HALF_UP).toPlainString(),
                    measuredBy = if (bags && line.decision == Decision.ACCEPTED) "bags" else "weight",
                    sacks = line.sacks.trim().toIntOrNull(),
                    kgPerBag = if (bags) number(line.kgPerBag)?.setScale(3, RoundingMode.HALF_UP)?.toPlainString() else null,
                    reason = line.reason.takeIf { line.decision == Decision.REJECTED },
                    note = line.note.trim().ifBlank { null },
                )
            },
            loadedKg = loadedKg(draft, items).toPlainString(),
        )
    }
}
