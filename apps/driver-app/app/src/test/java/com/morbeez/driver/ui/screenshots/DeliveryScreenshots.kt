package com.morbeez.driver.ui.screenshots

import com.morbeez.driver.ui.screens.home.DayLogic
import com.morbeez.driver.ui.screens.route.RouteUiState
import com.morbeez.driver.ui.screens.route.RouteContent
import com.morbeez.driver.ui.components.WithRefusal
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.device.Position
import com.morbeez.driver.data.local.CrateDraft
import com.morbeez.driver.data.local.DeliveryDraft
import com.morbeez.driver.data.local.QrState
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CrateTypeResponse
import com.morbeez.driver.data.remote.dto.StopItemResponse
import com.morbeez.driver.ui.components.PhotoButtonLook
import com.morbeez.driver.ui.screens.deliver.DeliveryLogic
import com.morbeez.driver.ui.screens.deliver.DeliveryStep
import com.morbeez.driver.ui.screens.deliver.DeliveryStopContent
import com.morbeez.driver.ui.screens.deliver.DeliveryUiState
import com.morbeez.driver.ui.screens.deliver.StockLine
import com.morbeez.driver.ui.screens.deliver.VehicleStockContent
import com.morbeez.driver.ui.screens.deliver.VehicleStockUiState
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.HomeShell
import com.morbeez.driver.ui.screens.home.HomeTab
import com.morbeez.driver.ui.screens.home.HomeUiState
import com.morbeez.driver.ui.screens.home.LinkState
import com.morbeez.driver.ui.theme.MorbeezTheme
import java.math.BigDecimal
import org.junit.Rule
import org.junit.Test

/**
 * The D3 delivery screens drawn on the JVM from a sample trip (design sheet
 * screens 8–12): ./gradlew recordPaparazziDebug.
 */
class DeliveryScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private val noCamera: PhotoSlot = { label, captured, _ -> PhotoButtonLook(label, captured) {} }

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    private fun deliver(state: DeliveryUiState, step: DeliveryStep, device: DeviceConfig = PHONE, refused: String? = null) = draw(device) {
        WithRefusal(refused, {}) { DeliveryStopContent(
            state = state,
            step = step,
            onStep = {},
            onBack = {},
            onStart = {},
            onArrive = {},
            onScan = {},
            onNotScanned = {},
            onEdit = {},
            onPhoto = { _, _ -> },
            onScalePhoto = { _, _ -> },
            onComplete = {},
            onCollect = {},
            photo = noCamera,
        ) }
    }

    private fun deliveryTab(state: HomeUiState) = draw(TALL) {
        HomeShell(
            state = state,
            tab = HomeTab.DELIVERY,
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

    @Test fun deliveryListBeforeStartTrip() = deliveryTab(HomeUiState(trip = trip, stops = stops, link = LinkState(), position = here))

    @Test fun deliveryListOnTheWay() = deliveryTab(HomeUiState(trip = started, stops = stops, link = LinkState(), position = here))

    @Test fun nextStop() = deliver(base, DeliveryStep.NEXT)

    @Test fun nextStopLocked() = deliver(base.copy(stop = shopB, next = shopA), DeliveryStep.NEXT)

    // Field hardening (D8): the office refused what was done here — said above the screen (DRV.8).
    @Test fun deliveryRefusedByOffice() = deliver(base, DeliveryStep.NEXT, refused = "This delivery was already completed from another phone")

    // The route with when the driver gets to each stop, and a stop the office refused.
    @Test fun routeWithArrivalTimes() = draw(TALL) {
        RouteContent(
            state = RouteUiState(
                trip = started,
                stops = stops,
                refused = mapOf("b" to "Green Leaf Mess is on credit hold"),
                etas = DayLogic.routeEtas(here.latitude, here.longitude, stops, NOW),
            ),
            onOpenStop = { _, _, _ -> },
            onHandover = {},
            onTripSummary = {},
            onBack = {},
            onOpenSync = {},
            onSync = {},
            onReportProblem = { _, _ -> },
        )
    }

    @Test fun scanWrongQr() = deliver(base.copy(stop = arrived, wrongQr = true), DeliveryStep.QR)

    @Test fun scanVerified() = deliver(base.copy(stop = arrived, draft = draft.copy(qr = QrState.VERIFIED, qrValue = "MORBEEZ:C:ABCD1234EF567890")), DeliveryStep.QR)

    @Test fun deliverItems() = deliver(base.copy(stop = arrived, draft = filled), DeliveryStep.ITEMS, TALL)

    @Test fun deliverItemsMalayalam() = deliver(base.copy(stop = arrived, draft = filled), DeliveryStep.ITEMS, TALL.copy(locale = "ml"))

    @Test fun delivered() = deliver(
        base.copy(stop = arrived.copy(status = "completed"), outcome = DeliveryLogic.outcomeOf(filled, items)),
        DeliveryStep.ITEMS,
    )

    @Test fun vehicleStockLeftOver() = draw {
        VehicleStockContent(
            VehicleStockUiState(
                registration = "KA01D10001",
                lines = listOf(
                    StockLine("p-tomato", "Tomato", "kg", BigDecimal("0.000"), BigDecimal.ZERO),
                    StockLine("p-onion", "Onion", "kg", BigDecimal("10.000"), BigDecimal.ZERO),
                    StockLine("p-ginger", "Ginger", "kg", BigDecimal("5.500"), BigDecimal.ZERO),
                ),
                deliveriesDone = true,
                unsent = 1,
                refreshedAt = 1_793_160_720_000L,
            ),
            onBack = {},
        )
    }

    private companion object {
        val PHONE = DeviceConfig.PIXEL_5
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 3300)
        val here = Position(12.3108, 76.6402, 8.0)
        // A fixed "now" for the arrival times (drawn in the test JVM's time zone; a phone shows its own).
        val NOW = java.time.Instant.parse("2026-10-28T05:30:00Z").toEpochMilli()

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
        val started = trip.copy(deliveryStartedAt = "2026-10-28T05:10:00Z")

        val items = listOf(
            StopItemResponse("Tomato", "100.000", "kg", "p-tomato", orderLineId = "l-tomato"),
            StopItemResponse("Onion", "50.000", "kg", "p-onion", orderLineId = "l-onion"),
        )

        // Sample parties from the dev seed; the phone is a placeholder, never dialled.
        fun shop(id: String, seq: Int, name: String, place: String, lat: Double, lng: Double, status: String = "pending", summary: String = "Tomato 100 kg, Onion 50 kg") = TripStopEntity(
            id = id,
            tripId = "t1",
            sequenceNumber = seq,
            stopType = "delivery",
            status = status,
            pickupId = null,
            orderId = "o-$id",
            counterpartyName = name,
            summary = summary,
            notes = null,
            collectTerms = "cash",
            collectAmount = "4000.00",
            partyPhone = "+910000000000",
            partyPlace = place,
            partyAddress = "Back gate, Sayyaji Rao Road",
            partyLatitude = lat,
            partyLongitude = lng,
            partyQrToken = "ABCD1234EF567890",
        )

        val farm = TripStopEntity(
            id = "f1", tripId = "t1", sequenceNumber = 1, stopType = "pickup", status = "completed", pickupId = "pk1", orderId = null,
            counterpartyName = "Ramesh Patil", summary = "Tomato 200 kg, Onion 100 kg", notes = null,
        )
        val shopA = shop("a", 2, "Hotel Sagar", "Sayyaji Rao Road", 12.3051, 76.6551)
        val shopB = shop("b", 3, "Green Leaf Mess", "Kuvempunagar", 12.2870, 76.6260, summary = "Tomato 80 kg").copy(collectTerms = "credit")
        val shopC = shop("c", 4, "Annapurna Mess", "Gokulam", 12.3200, 76.6300, summary = "Onion 40 kg").copy(collectTerms = "credit")
        val stops = listOf(farm, shopA, shopB, shopC)
        val arrived = shopA.copy(arrivedAt = "2026-10-28T05:40:00Z")

        val crateTypes = listOf(CrateTypeResponse("c-1", "DL20", "Delivery crate"))
        val draft = DeliveryLogic.withItems(DeliveryDraft(), items, crateTypes, "Hotel Sagar")
        val filled = draft.copy(
            qr = QrState.VERIFIED,
            qrValue = "MORBEEZ:C:ABCD1234EF567890",
            lines = draft.lines.map { if (it.orderLineId == "l-onion") it.copy(delivered = "40", shortReason = "customer_took_less", shortNote = "Slow day") else it },
            allUnloaded = true,
            crates = listOf(CrateDraft("c-1", dropped = "10", collected = "8")),
            recipient = "Manager, Hotel Sagar",
            podPhotos = 1,
        )

        val base = DeliveryUiState(trip = started, stop = shopA, items = items, draft = draft, crateTypes = crateTypes, next = shopA, position = here)
    }
}
