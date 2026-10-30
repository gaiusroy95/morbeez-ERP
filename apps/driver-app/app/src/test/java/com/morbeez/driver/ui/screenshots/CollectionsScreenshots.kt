package com.morbeez.driver.ui.screenshots

import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.local.TripStopEntity
import com.morbeez.driver.data.remote.dto.CollectedTotals
import com.morbeez.driver.data.remote.dto.CollectionCustomerResponse
import com.morbeez.driver.data.remote.dto.HandoverResponse
import com.morbeez.driver.data.remote.dto.TripCollectionsResponse
import com.morbeez.driver.ui.components.PhotoButtonLook
import com.morbeez.driver.ui.screens.collect.CollectionsContent
import com.morbeez.driver.ui.screens.collect.CollectionsLogic
import com.morbeez.driver.ui.screens.collect.CollectionsUiState
import com.morbeez.driver.ui.screens.collect.EndOfTripUiState
import com.morbeez.driver.ui.screens.collect.HandoverContent
import com.morbeez.driver.ui.screens.collect.RecordCollectionContent
import com.morbeez.driver.ui.screens.collect.ReturnContent
import com.morbeez.driver.ui.screens.collect.TripSummaryContent
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.theme.MorbeezTheme
import java.math.BigDecimal
import org.junit.Rule
import org.junit.Test

/**
 * The D4 screens drawn on the JVM from a sample trip (design sheet screens
 * 15–21): ./gradlew recordPaparazziDebug.
 */
class CollectionsScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private val noCamera: PhotoSlot = { label, captured, _ -> PhotoButtonLook(label, captured) {} }

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    @Test fun collections() = draw(TALL) { CollectionsContent(collections, onBack = {}, onCollect = { _, _ -> }, onReturn = {}) }

    @Test fun collectionsMalayalam() = draw(TALL.copy(locale = "ml")) { CollectionsContent(collections, onBack = {}, onCollect = { _, _ -> }, onReturn = {}) }

    @Test fun recordCollection() = draw(TALL) {
        RecordCollectionContent(
            row = collections.rows.first(),
            disputeSent = false,
            onBack = {},
            onReceive = { _, _, _, _, _ -> },
            onDispute = { _, _ -> },
            onProof = { _, _ -> },
            photo = noCamera,
        )
    }

    @Test fun returnToBase() = draw { ReturnContent(end.copy(collections = collections.copy(trip = trip.copy(closingKm = "48842.0"))), onBack = {}, onConfirm = {}) }

    @Test fun cashHandover() = draw(TALL) { HandoverContent(returned, onBack = {}, onReturn = {}, onRefresh = {}) { _, _ -> } }

    @Test fun tripSummary() = draw(TALL) {
        TripSummaryContent(returned.copy(collections = returned.collections.copy(trip = returned.trip!!.copy(status = "completed", cashDeclared = "45800.00"))), onBack = {})
    }

    private companion object {
        val PHONE = DeviceConfig.PIXEL_5
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 3100)

        val trip = TripEntity(
            id = "t1",
            vehicleId = "v1",
            vehicleRegistrationNumber = "KA01D10001",
            driverEmployeeId = "e1",
            status = "in_progress",
            plannedDate = "2026-10-28",
            advanceAmount = "500.00",
            version = 4,
            number = "T-20261028-001",
            openingKm = "48650.0",
            deliveryStartedAt = "2026-10-28T05:10:00Z",
        )

        // Sample parties from the dev seed; the phones are placeholders, never dialled.
        fun shop(id: String, seq: Int, name: String, type: String = "delivery") = TripStopEntity(
            id = id, tripId = "t1", sequenceNumber = seq, stopType = type, status = "completed", pickupId = null, orderId = "o-$id",
            counterpartyName = name, summary = "", notes = null, partyPhone = "+910000000000",
        )

        val stops = listOf(shop("f", 1, "Ramesh Patil", "pickup"), shop("a", 2, "Hotel Sagar"), shop("b", 3, "Green Leaf Mess"), shop("c", 4, "Annapurna Mess"))

        val board = TripCollectionsResponse(
            tripId = "t1",
            customers = listOf(
                CollectionCustomerResponse("c-a", "Hotel Sagar", "+910000000000", "Sayyaji Rao Road", "a", "cash", "48500.00", "200.00", "0.00"),
                CollectionCustomerResponse("c-b", "Green Leaf Mess", "+910000000000", "Kuvempunagar", "b", "credit", "72000.00", "0.00", "0.00"),
                CollectionCustomerResponse("c-c", "Annapurna Mess", "+910000000000", "Gokulam", "c", "credit", "0.00", "0.00", "31500.00"),
            ),
            collected = CollectedTotals(cash = "31500.00", upi = "0.00", bankTransfer = "0.00", total = "31500.00"),
        )

        val collections = CollectionsUiState(
            trip = trip,
            stops = stops,
            rows = CollectionsLogic.rowsOf(board, stops, emptyList(), emptyList()),
            collected = CollectionsLogic.collectedOf(board, emptyList()),
        )

        val end = EndOfTripUiState(collections = collections, leftKg = BigDecimal.ZERO, cratesLeft = 50, cratesBack = 50)
        val returned = end.copy(
            collections = collections.copy(trip = trip.copy(closingKm = "48842.0", returnedAt = "2026-10-28T12:40:00Z")),
            handover = HandoverResponse(
                openingCash = "500.00",
                cashCollections = "48500.00",
                spotCash = "3000.00",
                expenses = "6200.00",
                deposited = "0.00",
                expected = "45800.00",
                declared = null,
                directPayments = "72000.00",
            ),
        )
    }
}
