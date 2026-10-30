package com.morbeez.driver.ui.screenshots

import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.HandoverResponse
import com.morbeez.driver.ui.components.PhotoButtonLook
import com.morbeez.driver.ui.screens.backhaul.AddBackhaulContent
import com.morbeez.driver.ui.screens.backhaul.BackhaulContent
import com.morbeez.driver.ui.screens.backhaul.BackhaulUiState
import com.morbeez.driver.ui.screens.collect.CollectionsUiState
import com.morbeez.driver.ui.screens.collect.EndOfTripUiState
import com.morbeez.driver.ui.screens.collect.HandoverContent
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.HomeShell
import com.morbeez.driver.ui.screens.home.HomeTab
import com.morbeez.driver.ui.screens.home.HomeUiState
import com.morbeez.driver.ui.screens.home.LinkState
import com.morbeez.driver.ui.theme.MorbeezTheme
import org.junit.Rule
import org.junit.Test

/**
 * The D5 screens drawn on the JVM from a sample trip (design sheet 3:
 * Backhaul Available, Backhaul in Progress, Backhaul Payment):
 * ./gradlew recordPaparazziDebug.
 */
class BackhaulScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private val noCamera: PhotoSlot = { label, captured, _ -> PhotoButtonLook(label, captured) {} }

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    private fun backhaul(state: BackhaulUiState, device: DeviceConfig = TALL) = draw(device) {
        BackhaulContent(
            state = state,
            onBack = {},
            onAdd = {},
            onReturn = {},
            onAccept = {},
            onSkip = { _, _ -> },
            onStep = { _, _ -> },
            onPhoto = { _, _, _, _ -> },
            onPay = { _, _, _, _, _ -> },
            photo = noCamera,
        )
    }

    @Test fun backhaulAvailable() = backhaul(BackhaulUiState(trip, stops, listOf(offer)))

    @Test fun backhaulAvailableMalayalam() = backhaul(BackhaulUiState(trip, stops, listOf(offer)), TALL.copy(locale = "ml"))

    @Test fun backhaulInProgress() = backhaul(BackhaulUiState(trip, stops, listOf(loaded, skipped)))

    @Test fun backhaulPayment() = backhaul(BackhaulUiState(trip, stops, listOf(completed)))

    @Test fun backhaulPaid() = backhaul(BackhaulUiState(trip, stops, listOf(paid, skipped)), PHONE)

    @Test fun addBackhaul() = draw { AddBackhaulContent(BackhaulUiState(trip, stops, emptyList()), onBack = {}) { _, _, _, _, _ -> } }

    @Test fun dashboardBackhaul() = draw(TALL) {
        HomeShell(
            state = HomeUiState(day = day, trip = trip, stops = stops, link = LinkState(), backhauls = listOf(offer)),
            tab = HomeTab.DASHBOARD,
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

    @Test fun handoverWithBackhaul() = draw(TALL) {
        HandoverContent(
            EndOfTripUiState(
                collections = CollectionsUiState(trip = trip.copy(closingKm = "48842.0", returnedAt = "2026-10-29T12:40:00Z"), stops = stops),
                backhauls = listOf(paid),
                handover = HandoverResponse(
                    openingCash = "500.00",
                    cashCollections = "48500.00",
                    spotCash = "0.00",
                    backhaulCash = "3500.00",
                    expenses = "6200.00",
                    deposited = "0.00",
                    expected = "46300.00",
                    declared = null,
                    directPayments = "0.00",
                ),
            ),
            onBack = {},
            onReturn = {},
            onRefresh = {},
        ) { _, _ -> }
    }

    private companion object {
        val PHONE = DeviceConfig.PIXEL_5
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 2600)

        val trip = TripEntity(
            id = "t1",
            vehicleId = "v1",
            vehicleRegistrationNumber = "KA01D10001",
            driverEmployeeId = "e1",
            status = "in_progress",
            plannedDate = "2026-10-29",
            advanceAmount = "500.00",
            version = 4,
            number = "T-20261029-004",
            openingKm = "48650.0",
            deliveryStartedAt = "2026-10-29T05:10:00Z",
        )

        val day = DriverDayEntity(
            today = "2026-10-29",
            driverName = "Raju Driver",
            vehicleRegistration = "KA01D10001",
            routeName = "Mysuru South",
            lastOdometerKm = "48620.0",
            weekFrom = "2026-10-26",
            earnedThisWeek = "3550.00",
            stockJson = null,
            refreshedAt = 0L,
        )

        // Sample parties from the dev seed: every stop done.
        val stops = listOf(
            TripStopEntity(id = "f", tripId = "t1", sequenceNumber = 1, stopType = "pickup", status = "completed", pickupId = null, orderId = null, counterpartyName = "Ramesh Patil", summary = "", notes = null),
            TripStopEntity(id = "a", tripId = "t1", sequenceNumber = 2, stopType = "delivery", status = "completed", pickupId = null, orderId = "o-a", counterpartyName = "Hotel Sagar", summary = "", notes = null),
        )

        // The design sheet's sample backhaul.
        val offer = BackhaulEntity(
            id = "b1", tripId = "t1", pickupPlace = "Mysuru Market", dropPlace = "Gundlupet Base", rent = "3500.00",
            hirerName = "Ravi Traders", notes = "Empty crates for the depot", offeredBy = "owner", status = "offered", createdAt = "2026-10-29T09:00:00Z",
        )
        val loaded = offer.copy(
            status = "accepted", acceptedAt = "2026-10-29T10:05:00Z", pickupReachedAt = "2026-10-29T10:50:00Z", loadedAt = "2026-10-29T11:15:00Z", loadPhotos = 1,
        )
        val completed = loaded.copy(status = "completed", dropReachedAt = "2026-10-29T12:20:00Z", completedAt = "2026-10-29T12:25:00Z", dropPhotos = 1)
        val paid = completed.copy(paymentMethod = "cash", amountReceived = "3500.00", paidAt = "2026-10-29T12:28:00Z", paymentPhotos = 1)
        val skipped = BackhaulEntity(
            id = "b2", tripId = "t1", pickupPlace = "Nanjangud", dropPlace = "Mysuru", rent = "1200.00",
            offeredBy = "owner", status = "skipped", skipReason = "Vehicle needed back early", createdAt = "2026-10-29T09:30:00Z",
        )
    }
}
