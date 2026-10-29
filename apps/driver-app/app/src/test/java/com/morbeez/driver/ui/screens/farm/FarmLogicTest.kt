package com.morbeez.driver.ui.screens.farm

import com.morbeez.driver.data.local.Decision
import com.morbeez.driver.data.local.FarmDraft
import com.morbeez.driver.data.local.FarmLineDraft
import com.morbeez.driver.data.remote.dto.CrewOptionResponse
import com.morbeez.driver.data.remote.dto.FarmLineRequest
import com.morbeez.driver.data.remote.dto.StopItemResponse
import java.math.BigDecimal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FarmLogicTest {
    private val ginger = StopItemResponse("Ginger", "500.000", "kg", "p-ginger")
    private val carrot = StopItemResponse("Carrot", "300.000", "kg", "p-carrot")
    private val eggs = StopItemResponse("Eggs", "300.000", "piece", "p-eggs", kind = "egg", packSize = 30)
    private val items = listOf(ginger, carrot, eggs)

    private fun draft(vararg lines: FarmLineDraft, byBags: Boolean = false) =
        FarmLogic.withItems(FarmDraft(lines = lines.toList(), byBags = byBags), items)

    @Test
    fun `every product gets a line, in the farm's order, keeping what was typed`() {
        val d = FarmLogic.withItems(FarmDraft(lines = listOf(FarmLineDraft("p-carrot", weight = "12"))), items)
        assertEquals(listOf("p-ginger", "p-carrot", "p-eggs"), d.lines.map { it.productId })
        assertEquals("12", d.lines[1].weight)
    }

    @Test
    fun `nothing is ready until every product is accepted or rejected`() {
        val d = draft(FarmLineDraft("p-ginger", Decision.ACCEPTED, weight = "480"))
        val r = FarmLogic.readinessOf(d, items)
        assertFalse(r.decided)
        assertFalse(r.ready)
    }

    @Test
    fun `a rejection needs its reason`() {
        assertEquals(LineProblem.NO_REASON, FarmLogic.problemOf(FarmLineDraft("p-ginger", Decision.REJECTED), ginger, false))
        assertNull(FarmLogic.problemOf(FarmLineDraft("p-ginger", Decision.REJECTED, reason = "damaged"), ginger, false))
    }

    @Test
    fun `an accepted product needs a weight that reads as a number`() {
        assertEquals(LineProblem.NO_QUANTITY, FarmLogic.problemOf(FarmLineDraft("p-ginger", Decision.ACCEPTED), ginger, false))
        assertEquals(LineProblem.BAD_NUMBER, FarmLogic.problemOf(FarmLineDraft("p-ginger", Decision.ACCEPTED, weight = "4.8.0"), ginger, false))
        assertEquals(LineProblem.BAD_NUMBER, FarmLogic.problemOf(FarmLineDraft("p-ginger", Decision.ACCEPTED, weight = "0"), ginger, false))
        assertNull(FarmLogic.problemOf(FarmLineDraft("p-ginger", Decision.ACCEPTED, weight = "480.5"), ginger, false))
    }

    @Test
    fun `by bags a kilo product is sacks times kg a bag, and a counted one keeps its count`() {
        val line = FarmLineDraft("p-carrot", Decision.ACCEPTED, sacks = "7", kgPerBag = "45")
        assertEquals(BigDecimal("315.000"), FarmLogic.quantityOf(line, carrot, byBags = true))
        assertEquals(LineProblem.NO_KG_PER_BAG, FarmLogic.problemOf(line.copy(kgPerBag = ""), carrot, true))
        assertEquals(LineProblem.NO_SACKS, FarmLogic.problemOf(line.copy(sacks = ""), carrot, true))
        val eggLine = FarmLineDraft("p-eggs", Decision.ACCEPTED, weight = "270")
        assertEquals(BigDecimal("270"), FarmLogic.quantityOf(eggLine, eggs, byBags = true))
    }

    @Test
    fun `loading needs the crew and a photo of the load, and a farm with nothing loaded needs neither`() {
        val loaded = draft(
            FarmLineDraft("p-ginger", Decision.ACCEPTED, weight = "480"),
            FarmLineDraft("p-carrot", Decision.REJECTED, reason = "quality_issue"),
            FarmLineDraft("p-eggs", Decision.ACCEPTED, weight = "270"),
        )
        var r = FarmLogic.readinessOf(loaded, items)
        assertTrue(r.decided && r.weighed)
        assertFalse(r.crew)
        assertFalse(r.photo)
        r = FarmLogic.readinessOf(loaded.copy(packerId = "w1", samePerson = true, loadPhotos = 1), items)
        assertTrue(r.ready)

        val nothing = draft(
            FarmLineDraft("p-ginger", Decision.REJECTED, reason = "farmer_not_ready"),
            FarmLineDraft("p-carrot", Decision.REJECTED, reason = "farmer_not_ready"),
            FarmLineDraft("p-eggs", Decision.REJECTED, reason = "farmer_not_ready"),
        )
        assertTrue(FarmLogic.readinessOf(nothing, items).ready)
    }

    @Test
    fun `the crew is credited with the kilos loaded, never pieces`() {
        val d = draft(
            FarmLineDraft("p-ginger", Decision.ACCEPTED, weight = "480.25"),
            FarmLineDraft("p-carrot", Decision.ACCEPTED, sacks = "7", kgPerBag = "45"),
            FarmLineDraft("p-eggs", Decision.ACCEPTED, weight = "270"),
            byBags = true,
        )
        // Ginger is a kilo product too: by bags it needs bags — so only carrot counts here.
        assertEquals(BigDecimal("315.000"), FarmLogic.loadedKg(d, items))
        assertEquals(BigDecimal("795.250"), FarmLogic.loadedKg(d.copy(byBags = false, lines = d.lines.map { if (it.productId == "p-carrot") it.copy(weight = "315") else it }), items))
    }

    @Test
    fun `what is sent is every product, by weight or by bags, rejections with reason and note`() {
        val d = draft(
            FarmLineDraft("p-ginger", Decision.REJECTED, reason = "quality_issue", note = "  soft "),
            FarmLineDraft("p-carrot", Decision.ACCEPTED, sacks = "7", kgPerBag = "45"),
            FarmLineDraft("p-eggs", Decision.ACCEPTED, weight = "270", sacks = "9"),
            byBags = true,
        )
        assertEquals(
            listOf(
                FarmLineRequest("p-ginger", "rejected", reason = "quality_issue", note = "soft"),
                FarmLineRequest("p-carrot", "accepted", measuredBy = "bags", sacks = 7, kgPerBag = 45.0),
                FarmLineRequest("p-eggs", "accepted", netQuantity = 270.0, measuredBy = "weight", sacks = 9),
            ),
            FarmLogic.requestOf(d, items),
        )
    }

    @Test
    fun `one person packing and loading is the loader too`() {
        assertEquals("w1", FarmLogic.loaderOf(FarmDraft(packerId = "w1", loaderId = "w2", samePerson = true)))
        assertEquals("w2", FarmLogic.loaderOf(FarmDraft(packerId = "w1", loaderId = "w2")))
    }

    @Test
    fun `until the server answers, the phone shows the stop as it was sent`() {
        val d = draft(
            FarmLineDraft("p-ginger", Decision.ACCEPTED, weight = "480"),
            FarmLineDraft("p-carrot", Decision.REJECTED, reason = "damaged"),
            FarmLineDraft("p-eggs", Decision.ACCEPTED, weight = "270"),
        ).copy(packerId = "w1", loaderId = "w2")
        val crew = listOf(CrewOptionResponse("w1", "Mani", "warehouse"), CrewOptionResponse("w2", "Kumar", "warehouse"))
        val outcome = FarmLogic.outcomeOf(d, items, crew)
        assertEquals("Mani", outcome.packer?.name)
        assertEquals("Kumar", outcome.loader?.name)
        assertEquals("480.000", outcome.loadedKg)
        assertEquals(listOf("accepted", "rejected", "accepted"), outcome.lines.map { it.outcome })
        assertEquals("damaged", outcome.lines[1].reason)
    }
}
