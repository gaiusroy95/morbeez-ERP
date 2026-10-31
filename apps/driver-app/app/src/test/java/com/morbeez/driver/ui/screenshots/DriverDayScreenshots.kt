package com.morbeez.driver.ui.screenshots

import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.device.Position
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.TripVehicleStockResponse
import com.morbeez.driver.data.remote.dto.VehicleStockRowResponse
import com.morbeez.driver.data.remote.dto.VehicleStockTotalsResponse
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.ui.screens.home.HomeShell
import com.morbeez.driver.ui.screens.home.HomeTab
import com.morbeez.driver.ui.screens.home.HomeUiState
import com.morbeez.driver.ui.screens.home.LinkState
import com.morbeez.driver.ui.screens.startday.GpsState
import com.morbeez.driver.ui.screens.startday.StartDayContent
import com.morbeez.driver.ui.screens.startday.StartDayUiState
import com.morbeez.driver.ui.screens.sync.SyncContent
import com.morbeez.driver.ui.screens.sync.SyncUiState
import com.morbeez.driver.ui.theme.MorbeezTheme
import java.time.LocalDateTime
import org.junit.Rule
import org.junit.Test

/**
 * The D1 screens drawn on the JVM from sample days (no emulator):
 * ./gradlew recordPaparazziDebug writes them to app/src/test/snapshots,
 * ./gradlew verifyPaparazziDebug compares against them.
 */
class DriverDayScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    private fun shell(state: HomeUiState, tab: HomeTab = HomeTab.DASHBOARD, drawerOpen: Boolean = false, device: DeviceConfig = PHONE) = draw(device) {
        HomeShell(
            state = state,
            tab = tab,
            onTab = {},
            drawer = rememberDrawerState(if (drawerOpen) DrawerValue.Open else DrawerValue.Closed),
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

    @Test fun dashboardOnTheRoad() = shell(onTheRoad, device = TALL)

    @Test fun dashboardPlanned() = shell(planned)

    @Test fun dashboardNoTrip() = shell(HomeUiState(day = day.copy(vehicleRegistration = null, stockJson = null), link = LinkState()))

    @Test fun dashboardMalayalam() = shell(onTheRoad, device = TALL.copy(locale = "ml"))

    @Test fun procurement() = shell(onTheRoad, HomeTab.PROCUREMENT)

    @Test fun delivery() = shell(onTheRoad, HomeTab.DELIVERY)

    @Test fun drawerOffline() = shell(onTheRoad.copy(link = LinkState(online = false, waiting = 3)), drawerOpen = true)

    // The office wrote (D9): the count on the header's chat button and in the drawer.
    @Test fun dashboardChatUnread() = shell(onTheRoad.copy(chatUnread = 2))

    @Test fun drawerChatUnread() = shell(onTheRoad.copy(chatUnread = 2), drawerOpen = true)

    @Test fun startDay() = draw {
        StartDayContent(
            state = StartDayUiState(day = day, trip = trip.copy(status = "planned", openingKm = null), stopCount = 4, gps = GpsState.LOCKED, position = here),
            km = "48650",
            onKm = {},
            touched = true,
            now = LocalDateTime.of(2026, 10, 28, 6, 12),
            onBack = {},
            onStart = {},
            onAllowLocation = {},
            onTurnOnLocation = {},
        )
    }

    @Test fun startDayBelowLastReading() = draw {
        StartDayContent(
            state = StartDayUiState(day = day, trip = trip.copy(status = "planned", openingKm = null), stopCount = 4, online = false, gps = GpsState.NO_PERMISSION),
            km = "48600",
            onKm = {},
            touched = true,
            now = LocalDateTime.of(2026, 10, 28, 6, 12),
            onBack = {},
            onStart = {},
            onAllowLocation = {},
            onTurnOnLocation = {},
        )
    }

    @Test fun syncRefusedStart() = draw {
        SyncContent(
            state = SyncUiState(
                link = LinkState(online = true, waiting = 3, failed = 1),
                failed = listOf(
                    PendingOperationEntity(
                        idempotencyKey = "k1",
                        tripId = "t1",
                        operationType = PendingOperationType.START_TRIP.name,
                        payloadJson = "{}",
                        createdAt = REFRESHED,
                        sequence = 1,
                        status = "failed_needs_review",
                        lastError = "Opening KM 48600 is below the vehicle's last reading, 48620 km",
                    ),
                ),
                refreshedAt = REFRESHED,
                lastOdometerKm = "48620.0",
            ),
            onBack = {},
            onSync = {},
            onCorrect = { _, _ -> },
        )
    }

    // Field hardening (D8): a refused collection and photo, what can be done about them.
    private val refusedCollection = PendingOperationEntity(
        idempotencyKey = "k2",
        tripId = "t1",
        operationType = PendingOperationType.RECORD_COLLECTION.name,
        payloadJson = """{"stopId":"s2","amount":4600.0,"method":"cash"}""",
        createdAt = REFRESHED,
        sequence = 2,
        status = "failed_needs_review",
        lastError = "That's more than Hotel Sagar owes (₹4,000.00)",
    )
    private val refusedState = SyncUiState(
        link = LinkState(online = true, waiting = 4, failed = 2),
        failed = listOf(refusedCollection),
        refreshedAt = REFRESHED,
        failedPhotos = listOf(
            PendingPhotoEntity(
                id = "ph1", tripId = "t1", stopId = "s2", photoType = "pod", localPath = "/x.jpg", mimeType = "image/jpeg",
                createdAt = REFRESHED, status = "failed_needs_review", lastError = "The photo is no longer on this phone",
            ),
        ),
        described = mapOf("k2" to "Collection — ₹4,600 cash, Hotel Sagar"),
    )

    @Test fun syncRefusedCollection() = draw(TALL) { SyncContent(refusedState, onBack = {}, onSync = {}, onCorrect = { _, _ -> }) }

    @Test fun syncRemoveRefused() = draw { SyncContent(refusedState, onBack = {}, onSync = {}, onCorrect = { _, _ -> }, initialDialog = 0) }

    // Return refused for its reading: read again and sent in its place.
    @Test fun syncCorrectClosingKm() = draw {
        val refusedReturn = refusedCollection.copy(
            idempotencyKey = "k3",
            operationType = PendingOperationType.RETURN_TRIP.name,
            payloadJson = """{"closingKm":48600.0}""",
            lastError = "Closing KM 48600 is below the opening KM, 48650 km",
        )
        SyncContent(refusedState.copy(failed = listOf(refusedReturn), described = mapOf("k3" to "Return — 48,600 km")), onBack = {}, onSync = {}, onCorrect = { _, _ -> }, initialDialog = 1)
    }

    private companion object {
        val PHONE = DeviceConfig.PIXEL_5
        /** A phone scrolled: the whole Dashboard in one picture. */
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 3300)

        // 28 Oct 2026, 09:42 IST.
        const val REFRESHED = 1_793_160_720_000L
        val here = Position(12.3108, 76.6402, 8.0)

        val day = DriverDayEntity(
            today = "2026-10-28",
            driverName = "Raju Driver",
            vehicleRegistration = "KA01D10001",
            routeName = "Mysuru north",
            lastOdometerKm = "48620.0",
            weekFrom = "2026-10-26",
            earnedThisWeek = "1850.00",
            stockJson = null,
            refreshedAt = REFRESHED,
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
            openingKm = "48650.0",
            startedAt = "2026-10-28T00:42:00Z",
        )

        // Sample parties from the dev seed; the phone is a placeholder, never dialled.
        fun stop(seq: Int, type: String, name: String, summary: String, status: String = "pending", place: String? = null, lat: Double? = null, lng: Double? = null, cash: String? = null, credit: Boolean = false) =
            TripStopEntity(
                id = "s$seq",
                tripId = "t1",
                sequenceNumber = seq,
                stopType = type,
                status = status,
                pickupId = null,
                orderId = null,
                counterpartyName = name,
                summary = summary,
                notes = null,
                collectTerms = if (cash != null) "cash" else if (credit) "credit" else null,
                collectAmount = cash,
                partyPhone = "+910000000000",
                partyPlace = place,
                partyLatitude = lat,
                partyLongitude = lng,
            )

        val stops = listOf(
            stop(1, "pickup", "Ramesh Patil", "Tomato 120 kg", status = "completed", place = "Hunsur"),
            stop(2, "pickup", "Green Valley Farm", "Onion 60 kg, Ginger 25 kg", place = "Bilikere", lat = 12.3440, lng = 76.4710),
            stop(3, "delivery", "Hotel Sagar", "Tomato 100 kg", place = "Sayyaji Rao Road", lat = 12.3051, lng = 76.6551, cash = "3000.00"),
            stop(4, "delivery", "Annapurna Mess", "Onion 60 kg, Ginger 25 kg", place = "Kuvempunagar", lat = 12.2870, lng = 76.6260, credit = true),
        )

        val stock = TripVehicleStockResponse(
            tripId = "t1",
            vehicleId = "v1",
            registrationNumber = "KA01D10001",
            rows = listOf(
                VehicleStockRowResponse("p1", "Tomato", "kg", "120.000", "100.000", "20.000", "100.000", "0.000"),
                VehicleStockRowResponse("p2", "Onion", "kg", "0.000", "0.000", "0.000", "60.000", "60.000"),
                VehicleStockRowResponse("p3", "Ginger", "kg", "0.000", "0.000", "0.000", "25.000", "25.000"),
            ),
            totalsKg = VehicleStockTotalsResponse("120.000", "185.000", "85.000"),
        )

        val onTheRoad = HomeUiState(day = day, trip = trip, stops = stops, stock = stock, link = LinkState(online = true, waiting = 1), position = here)

        val planned = HomeUiState(
            day = day,
            trip = trip.copy(status = "planned", openingKm = null, startedAt = null),
            stops = stops.map { it.copy(status = "pending") },
            stock = stock.copy(rows = stock.rows.map { it.copy(onVehicle = "0.000") }, totalsKg = VehicleStockTotalsResponse("0.000", "185.000", "185.000")),
            link = LinkState(),
            position = here,
        )
    }
}
