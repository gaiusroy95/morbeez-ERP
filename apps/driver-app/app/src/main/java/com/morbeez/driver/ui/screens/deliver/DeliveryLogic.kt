package com.morbeez.driver.ui.screens.deliver

import com.morbeez.driver.data.local.CrateDraft
import com.morbeez.driver.data.local.DeliveryDraft
import com.morbeez.driver.data.local.DeliveryLineDraft
import com.morbeez.driver.data.local.QrState
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CompleteDeliveryRequest
import com.morbeez.driver.data.remote.dto.CrateTypeResponse
import com.morbeez.driver.data.remote.dto.DeliveredQuantity
import com.morbeez.driver.data.remote.dto.DeliveryCrates
import com.morbeez.driver.data.remote.dto.DeliveryCratesCount
import com.morbeez.driver.data.remote.dto.DeliveryLineMeasure
import com.morbeez.driver.data.remote.dto.DeliveryOutcomeResponse
import com.morbeez.driver.data.remote.dto.DeliveryShortfallResponse
import com.morbeez.driver.data.remote.dto.FarmStopOutcomeResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.data.remote.dto.TripVehicleStockResponse
import java.math.BigDecimal
import java.math.RoundingMode

/** Why a shop's goods were short (client spec §13), as the server names them. */
val SHORT_REASONS = listOf("customer_took_less", "damaged", "not_enough_on_vehicle", "quality_issue", "other")

/** What's wrong with a line, if anything. */
enum class DeliveryProblem { BAD_NUMBER, NO_REASON, TOO_MANY_BROKEN }

/** The delivery's checklist (client spec §11: QR ✓ → quantities ✓ → unloaded ✓ → photo ✓ → crates ✓). */
data class DeliveryReadiness(val qr: Boolean, val quantities: Boolean, val unloaded: Boolean, val photo: Boolean, val recipient: Boolean) {
    val ready get() = qr && quantities && unloaded && photo && recipient
}

/** A product on the vehicle, as the phone reckons it: the server's last count, and what's been done since. */
data class StockLine(val productId: String, val product: String, val uom: String, val onVehicle: BigDecimal, val toDeliver: BigDecimal)

/**
 * The delivery stop's rules, kept apart from Android so they're
 * unit-tested: the shop's own QR (or why there wasn't one), what left the
 * vehicle for each line and why when short, everything unloaded, a photo,
 * crates; what's sent and what the phone shows until the server answers;
 * the next delivery in order; and what's still on the vehicle.
 */
object DeliveryLogic {
    /** The text the printed QR carries: MORBEEZ:C:<token>. */
    const val QR_PREFIX = "MORBEEZ:C:"

    /** Whether what was scanned is this shop's QR — the printed text or the bare token. */
    fun qrMatches(scanned: String, token: String?): Boolean {
        if (token.isNullOrBlank()) return false
        val value = scanned.trim().uppercase()
        val bare = if (value.startsWith(QR_PREFIX)) value.removePrefix(QR_PREFIX) else value
        return bare.isNotEmpty() && bare == token.trim().uppercase()
    }

    /** A typed number: up to 3 decimals, not negative; null when blank or unreadable. */
    fun number(text: String): BigDecimal? {
        val n = text.trim().toBigDecimalOrNull() ?: return null
        if (n.signum() < 0 || n.stripTrailingZeros().scale() > 3) return null
        return n
    }

    private fun plain(q: String) = q.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString() ?: q

    /** One line per order line (delivered starting at what was ordered), one row per crate type, the shop's name as who received it. */
    fun withItems(draft: DeliveryDraft, items: List<StopItemResponse>, crateTypes: List<CrateTypeResponse>, shop: String): DeliveryDraft {
        val have = draft.lines.associateBy { it.orderLineId }
        val crates = draft.crates.associateBy { it.crateTypeId }
        return draft.copy(
            lines = items.mapNotNull { item -> item.orderLineId?.let { have[it] ?: DeliveryLineDraft(it, delivered = plain(item.quantity)) } },
            crates = crateTypes.map { crates[it.id] ?: CrateDraft(it.id) },
            recipient = draft.recipient.ifBlank { shop },
        )
    }

    fun isShort(line: DeliveryLineDraft, item: StopItemResponse): Boolean {
        val delivered = number(line.delivered) ?: return false
        val ordered = item.quantity.toBigDecimalOrNull() ?: return false
        return delivered < ordered
    }

    fun problemOf(line: DeliveryLineDraft, item: StopItemResponse): DeliveryProblem? {
        val delivered = number(line.delivered) ?: return DeliveryProblem.BAD_NUMBER
        if (line.customerWeight.isNotBlank() && number(line.customerWeight) == null) return DeliveryProblem.BAD_NUMBER
        if (line.broken.isNotBlank()) {
            val broken = line.broken.trim().toBigDecimalOrNull()?.takeIf { it.signum() >= 0 && it.stripTrailingZeros().scale() <= 0 } ?: return DeliveryProblem.BAD_NUMBER
            if (broken > delivered) return DeliveryProblem.TOO_MANY_BROKEN
        }
        if (isShort(line, item) && line.shortReason == null) return DeliveryProblem.NO_REASON
        return null
    }

    fun readinessOf(draft: DeliveryDraft, items: List<StopItemResponse>): DeliveryReadiness {
        val byLine = items.filter { it.orderLineId != null }.associateBy { it.orderLineId!! }
        return DeliveryReadiness(
            qr = draft.qr == QrState.VERIFIED || (draft.qr == QrState.NOT_SCANNED && !draft.qrNote.isNullOrBlank()),
            quantities = draft.lines.size == byLine.size && draft.lines.all { line -> byLine[line.orderLineId]?.let { problemOf(line, it) } == null },
            unloaded = draft.allUnloaded,
            photo = draft.podPhotos > 0,
            recipient = draft.recipient.isNotBlank(),
        )
    }

    private fun count(text: String) = text.trim().toIntOrNull()?.takeIf { it > 0 } ?: 0

    /** What's sent at hold-to-complete. Only what differs from the order goes as a line. */
    fun requestOf(draft: DeliveryDraft, items: List<StopItemResponse>): CompleteDeliveryRequest {
        val byLine = items.filter { it.orderLineId != null }.associateBy { it.orderLineId!! }
        val lines = draft.lines.mapNotNull { line ->
            val item = byLine[line.orderLineId] ?: return@mapNotNull null
            val delivered = number(line.delivered)
            val ordered = item.quantity.toBigDecimalOrNull()
            val differs = delivered != null && ordered != null && delivered.compareTo(ordered) != 0
            val short = isShort(line, item)
            val weight = if (item.kind == "live_bird") number(line.customerWeight) else null
            val broken = if (item.kind == "egg") line.broken.trim().toBigDecimalOrNull()?.takeIf { it.signum() > 0 } else null
            if (!differs && weight == null && broken == null) return@mapNotNull null
            DeliveryLineMeasure(
                orderLineId = line.orderLineId,
                customerWeight = weight?.toDouble(),
                brokenQuantity = broken?.toDouble(),
                deliveredQuantity = if (differs) delivered?.toDouble() else null,
                shortReason = if (short) line.shortReason else null,
                shortNote = if (short) line.shortNote.trim().ifBlank { null } else null,
            )
        }
        return CompleteDeliveryRequest(
            recipientName = draft.recipient.trim(),
            signatureData = null,
            lines = lines,
            qrToken = draft.qrValue.takeIf { draft.qr == QrState.VERIFIED },
            qrNote = draft.qrNote?.trim()?.takeIf { draft.qr == QrState.NOT_SCANNED && it.isNotEmpty() },
            allUnloaded = draft.allUnloaded,
            crates = draft.crates
                .map { DeliveryCrates(it.crateTypeId, count(it.dropped), count(it.collected)) }
                .filter { it.dropped > 0 || it.collected > 0 }
                .ifEmpty { null },
        )
    }

    /** The completed delivery as this phone shows it — and counts it off the vehicle — until the server's copy arrives. */
    fun outcomeOf(draft: DeliveryDraft, items: List<StopItemResponse>): DeliveryOutcomeResponse {
        val byLine = items.filter { it.orderLineId != null }.associateBy { it.orderLineId!! }
        return DeliveryOutcomeResponse(
            recipientName = draft.recipient.trim(),
            qrStatus = when (draft.qr) {
                QrState.VERIFIED -> "scanned"
                QrState.NOT_SCANNED -> "not_scanned"
                QrState.NONE -> null
            },
            qrNote = draft.qrNote.takeIf { draft.qr == QrState.NOT_SCANNED },
            allUnloaded = draft.allUnloaded,
            shortfalls = draft.lines.mapNotNull { line ->
                val item = byLine[line.orderLineId] ?: return@mapNotNull null
                if (!isShort(line, item)) return@mapNotNull null
                DeliveryShortfallResponse(
                    orderLineId = line.orderLineId,
                    productName = item.productName,
                    uom = item.uom,
                    ordered = item.quantity,
                    delivered = number(line.delivered)?.setScale(3, RoundingMode.HALF_UP)?.toPlainString() ?: "0.000",
                    reason = line.shortReason ?: "other",
                    note = line.shortNote.trim().ifBlank { null },
                )
            },
            crates = DeliveryCratesCount(draft.crates.sumOf { count(it.dropped) }, draft.crates.sumOf { count(it.collected) }),
            delivered = draft.lines.mapNotNull { line ->
                val item = byLine[line.orderLineId] ?: return@mapNotNull null
                DeliveredQuantity(item.productId, (number(line.delivered) ?: BigDecimal.ZERO).setScale(3, RoundingMode.HALF_UP).toPlainString())
            },
        )
    }

    /** The next delivery to make: the first not done, in the owner's visiting order. Every other one waits (client spec §11). */
    fun nextDelivery(stops: List<TripStopEntity>): TripStopEntity? =
        stops.filter { it.stopType == "delivery" && it.status == "pending" }.minByOrNull { it.sequenceNumber }

    /**
     * What's on the vehicle now, as the phone reckons it: the server's last
     * count, plus farms and minus deliveries done on this phone since that
     * the server hasn't counted yet.
     */
    fun stockOf(
        snapshot: TripVehicleStockResponse?,
        stops: List<TripStopEntity>,
        farms: Map<String, FarmStopOutcomeResponse>,
        deliveries: Map<String, DeliveryOutcomeResponse>,
        items: (TripStopEntity) -> List<StopItemResponse>,
    ): List<StockLine> {
        val rows = linkedMapOf<String, StockLine>()
        snapshot?.rows?.forEach { r ->
            rows[r.productId] = StockLine(r.productId, r.product, r.uom, r.onVehicle.toBigDecimalOrNull() ?: BigDecimal.ZERO, r.toDeliver.toBigDecimalOrNull() ?: BigDecimal.ZERO)
        }
        for (stop in stops.filter { it.pendingSync && it.status == "completed" }) {
            farms[stop.id]?.lines?.filter { it.outcome == "accepted" }?.forEach { l ->
                val q = l.acceptedQuantity.toBigDecimalOrNull() ?: BigDecimal.ZERO
                val row = rows[l.productId] ?: StockLine(l.productId, l.productName, l.uom, BigDecimal.ZERO, BigDecimal.ZERO)
                rows[l.productId] = row.copy(onVehicle = row.onVehicle + q)
            }
            val delivered = deliveries[stop.id]?.delivered ?: continue
            val ordered = items(stop).associateBy { it.productId }
            delivered.forEach { d ->
                val q = d.quantity.toBigDecimalOrNull() ?: BigDecimal.ZERO
                val row = rows[d.productId] ?: return@forEach
                val asked = ordered[d.productId]?.quantity?.toBigDecimalOrNull() ?: q
                rows[d.productId] = row.copy(onVehicle = (row.onVehicle - q).max(BigDecimal.ZERO), toDeliver = (row.toDeliver - asked).max(BigDecimal.ZERO))
            }
        }
        return rows.values.toList()
    }

    /** The kilos of it all. */
    fun kgOf(lines: List<StockLine>, pick: (StockLine) -> BigDecimal): BigDecimal =
        lines.filter { it.uom == "kg" }.fold(BigDecimal.ZERO) { sum, l -> sum + pick(l) }.setScale(3, RoundingMode.HALF_UP)
}
