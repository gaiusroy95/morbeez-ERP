package com.morbeez.driver.ui.screenshots

import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.device.Position
import com.morbeez.driver.data.local.Decision
import com.morbeez.driver.data.local.FarmDraft
import com.morbeez.driver.data.local.FarmLineDraft
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CrewOptionResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.ui.components.PhotoButtonLook
import com.morbeez.driver.ui.screens.farm.FarmLogic
import com.morbeez.driver.ui.screens.farm.FarmStep
import com.morbeez.driver.ui.screens.farm.FarmStopContent
import com.morbeez.driver.ui.screens.farm.FarmUiState
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.HomeShell
import com.morbeez.driver.ui.screens.home.HomeTab
import com.morbeez.driver.ui.screens.home.HomeUiState
import com.morbeez.driver.ui.screens.home.LinkState
import com.morbeez.driver.ui.theme.MorbeezTheme
import org.junit.Rule
import org.junit.Test

/**
 * The D2 farmer stop drawn on the JVM from a sample farm (design sheet
 * screens 4–7): ./gradlew recordPaparazziDebug.
 */
class FarmStopScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private val noCamera: PhotoSlot = { label, captured, _ -> PhotoButtonLook(label, captured) {} }

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    private fun farm(state: FarmUiState, step: FarmStep, rejecting: String? = null, device: DeviceConfig = PHONE) = draw(device) {
        FarmStopContent(
            state = state,
            step = step,
            onStep = {},
            rejecting = rejecting,
            onRejecting = {},
            onBack = {},
            onArrive = {},
            onEdit = {},
            onLoadPhoto = { _, _ -> },
            onRejectionPhoto = { _, _, _ -> },
            onComplete = {},
            onReport = {},
            photo = noCamera,
        )
    }

    @Test fun farmerStopNotReached() = farm(base.copy(stop = stop.copy(arrivedAt = null), draft = FarmLogic.withItems(FarmDraft(), items)), FarmStep.PRODUCTS)

    @Test fun farmerStopDeciding() = farm(base.copy(draft = deciding), FarmStep.PRODUCTS, device = TALL)

    @Test fun rejectProduct() = farm(base.copy(draft = deciding), FarmStep.PRODUCTS, rejecting = "p-ginger")

    @Test fun packingCrew() = farm(base.copy(draft = packed), FarmStep.PACK, device = TALL)

    @Test fun weighByBags() = farm(base.copy(draft = packed.copy(byBags = true)), FarmStep.WEIGH, device = TALL)

    @Test fun loadComplete() = farm(base.copy(draft = weighed), FarmStep.LOAD, device = TALL)

    @Test fun loadCompleteMalayalam() = farm(base.copy(draft = weighed), FarmStep.LOAD, device = TALL.copy(locale = "ml"))

    @Test fun completedFarm() = farm(
        base.copy(stop = stop.copy(status = "completed"), outcome = FarmLogic.outcomeOf(weighed, items, crew)),
        FarmStep.PRODUCTS,
    )

    @Test fun procurementComplete() = draw(TALL) {
        val done = FarmLogic.outcomeOf(weighed, items, crew)
        HomeShell(
            state = HomeUiState(
                trip = trip,
                stops = listOf(stop.copy(status = "completed"), stop.copy(id = "s2", sequenceNumber = 2, counterpartyName = "Lakshmi Devi", partyPlace = "Bilikere", status = "completed")),
                link = LinkState(),
                farms = mapOf("s1" to done, "s2" to done.copy(loadedKg = "190.000", lines = done.lines.take(1))),
            ),
            tab = HomeTab.PROCUREMENT,
            onTab = {},
            drawer = rememberDrawerState(DrawerValue.Closed),
            onStartDay = {},
            onOpenStop = { _, _, _ -> },
            onOpenTrip = {},
            onOpenExpenses = {},
            onOpenSync = {},
            onSync = {},
            onSignOut = { _, _ -> },
            onSignedOut = {},
        )
    }

    private companion object {
        val PHONE = DeviceConfig.PIXEL_5
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 3300)

        val items = listOf(
            StopItemResponse("Ginger", "500.000", "kg", "p-ginger"),
            StopItemResponse("Carrot", "300.000", "kg", "p-carrot"),
            StopItemResponse("Onion", "200.000", "kg", "p-onion"),
        )

        val trip = TripEntity(
            id = "t1",
            vehicleId = "v1",
            vehicleRegistrationNumber = "KA01D10001",
            driverEmployeeId = "e1",
            status = "in_progress",
            plannedDate = "2026-10-28",
            advanceAmount = "500.00",
            version = 2,
            number = "T-20261028-001",
        )

        // Sample parties from the dev seed; the phone is a placeholder, never dialled.
        val stop = TripStopEntity(
            id = "s1",
            tripId = "t1",
            sequenceNumber = 1,
            stopType = "pickup",
            status = "pending",
            pickupId = "pk1",
            orderId = null,
            counterpartyName = "Ramesh Patil",
            summary = "Ginger 500 kg, Carrot 300 kg, Onion 200 kg",
            notes = null,
            partyPhone = "+910000000000",
            partyPlace = "Hunsur",
            partyLatitude = 12.3440,
            partyLongitude = 76.4710,
            arrivedAt = "2026-10-28T03:40:00Z",
        )

        val crew = listOf(
            CrewOptionResponse("w1", "Mani", "warehouse"),
            CrewOptionResponse("w2", "Kumar", "warehouse"),
            CrewOptionResponse("e1", "Raju Driver", "driver"),
        )

        val base = FarmUiState(stop = stop, items = items, crew = crew, authorityLevel = 4, position = Position(12.3108, 76.6402, 8.0))

        val deciding = FarmLogic.withItems(
            FarmDraft(
                lines = listOf(
                    FarmLineDraft("p-ginger", Decision.REJECTED, reason = "quality_issue", note = "Soft, black spots"),
                    FarmLineDraft("p-carrot", Decision.ACCEPTED),
                ),
            ),
            items,
        )

        val packed = FarmLogic.withItems(
            FarmDraft(
                lines = listOf(
                    FarmLineDraft("p-ginger", Decision.REJECTED, reason = "quality_issue", note = "Soft, black spots"),
                    FarmLineDraft("p-carrot", Decision.ACCEPTED, sacks = "7", kgPerBag = "45"),
                    FarmLineDraft("p-onion", Decision.ACCEPTED, sacks = "5", kgPerBag = "38"),
                ),
                packerId = "w1",
                loaderId = "w2",
            ),
            items,
        )

        val weighed = packed.copy(
            lines = packed.lines.map {
                when (it.productId) {
                    "p-carrot" -> it.copy(weight = "315")
                    "p-onion" -> it.copy(weight = "190")
                    else -> it
                }
            },
            loadPhotos = 2,
        )
    }
}
