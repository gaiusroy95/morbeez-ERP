package com.morbeez.driver.ui.screenshots

import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.local.BackhaulEntity
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.remote.dto.DriverSettlementResponse
import com.morbeez.driver.data.remote.dto.EarningsLineResponse
import com.morbeez.driver.data.remote.dto.IncentiveRuleResponse
import com.morbeez.driver.data.remote.dto.MyEarningsResponse
import com.morbeez.driver.data.remote.dto.SettlementLineResponse
import com.morbeez.driver.ui.components.PhotoButtonLook
import com.morbeez.driver.ui.screens.backhaul.BackhaulContent
import com.morbeez.driver.ui.screens.backhaul.BackhaulUiState
import com.morbeez.driver.ui.screens.earnings.EarningsUiState
import com.morbeez.driver.ui.screens.earnings.MyEarningsContent
import com.morbeez.driver.ui.screens.earnings.SettlementsContent
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.theme.MorbeezTheme
import org.junit.Rule
import org.junit.Test

/**
 * The D7 screens drawn on the JVM from sample earnings (design sheet 3:
 * My Earnings; the drawer's Settlements; the backhaul offer's incentive):
 * ./gradlew recordPaparazziDebug.
 */
class EarningsScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private val noCamera: PhotoSlot = { label, captured, _ -> PhotoButtonLook(label, captured) {} }

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    @Test fun myEarningsToday() = draw(TALL) { MyEarningsContent(state, onBack = {}, onSettlements = {}, onRefresh = {}) }

    @Test fun myEarningsWeekWithEstimate() = draw(TALL) { MyEarningsContent(state, onBack = {}, onSettlements = {}, onRefresh = {}, initialPeriod = "week") }

    @Test fun myEarningsMalayalam() = draw(TALL.copy(locale = "ml")) { MyEarningsContent(state, onBack = {}, onSettlements = {}, onRefresh = {}) }

    @Test fun myEarningsNotYetRead() = draw { MyEarningsContent(EarningsUiState(day = day, online = false), onBack = {}, onSettlements = {}, onRefresh = {}) }

    @Test fun settlements() = draw(TALL) { SettlementsContent(state, onBack = {}, onRefresh = {}, onReceived = {}) }

    @Test fun backhaulOfferWithIncentive() = draw(TALL) {
        BackhaulContent(
            state = BackhaulUiState(trip, emptyList(), listOf(offer), rules),
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

    private companion object {
        val PHONE = DeviceConfig.PIXEL_5
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 3000)

        val trip = TripEntity(
            id = "t1", vehicleId = "v1", vehicleRegistrationNumber = "KA01D10001", driverEmployeeId = "e1", status = "in_progress",
            plannedDate = "2026-10-29", advanceAmount = "0.00", version = 4, number = "T-20261029-004", openingKm = "48650.0",
        )

        val day = DriverDayEntity(
            today = "2026-10-29", driverName = "Raju Driver", vehicleRegistration = "KA01D10001", routeName = null, lastOdometerKm = "48620.0",
            weekFrom = "2026-10-26", earnedThisWeek = "3550.00", stockJson = null, refreshedAt = 0L,
        )

        val rules = listOf(
            "collection" to "0.200", "backhaul" to "10.000", "mileage" to "50.000", "crates" to "1.000", "quality" to "0.100",
            "new_customer" to "2.000", "performance" to "0.200", "night_duty" to "25.000", "data_quality" to "10.000", "completion" to "20.000",
        ).map { (k, p) -> IncentiveRuleResponse(k, p) }

        // The design sheet's day: ₹1,200 fixed and the ten incentives — ₹3,550 in all.
        private fun line(kind: String, label: String, amount: String, estimated: String = "0.00") = EarningsLineResponse(kind, label, amount, estimated, if (amount == "0.00") 0 else 1)
        val today = MyEarningsResponse(
            period = "today", from = "2026-10-29", to = "2026-10-29", fixedPay = "1200.00",
            lines = listOf(
                line("collection", "Collection incentive", "300.00"), line("backhaul", "Backhaul incentive", "350.00"),
                line("mileage", "Mileage incentive", "500.00"), line("crates", "Crate incentive", "200.00"),
                line("quality", "Quality incentive", "150.00"), line("new_customer", "New customer incentive", "200.00"),
                line("performance", "Performance incentive", "300.00"), line("night_duty", "Night duty", "0.00"),
                line("data_quality", "Data quality", "100.00"), line("completion", "Trip completion", "250.00"),
            ),
            incentives = "2350.00", total = "3550.00", rules = rules,
        )
        val week = today.copy(
            period = "week", from = "2026-10-26", fixedPay = "4800.00",
            lines = today.lines.map { it.copy(amount = (it.amount.toBigDecimal() * 4.toBigDecimal()).toPlainString(), estimated = if (it.kind == "backhaul") "350.00" else "0.00") },
            incentives = "9400.00", estimated = "350.00", total = "14200.00",
        )
        val month = week.copy(period = "month", from = "2026-10-01")

        val settlements = listOf(
            DriverSettlementResponse(
                id = "s2", number = 14, periodStart = "2026-10-19", periodEnd = "2026-10-25", status = "paid", gross = "13850.00", deductions = "1000.00", net = "12850.00",
                paidAt = "2026-10-27T05:30:00Z", paidFrom = "bank", paymentReference = "NEFT 4471",
                lines = listOf(
                    SettlementLineResponse("basic", "Daily wage — 6 day(s)", "7200.00"),
                    SettlementLineResponse("incentive", "Backhaul incentive — trip T-20261023-002", "350.00"),
                    SettlementLineResponse("incentive", "Trip completion — trip T-20261023-002", "250.00"),
                    SettlementLineResponse("advance_recovery", "Advance of 2026-10-10 recovered", "-1000.00"),
                ),
            ),
            DriverSettlementResponse(id = "s1", number = 11, periodStart = "2026-10-12", periodEnd = "2026-10-18", status = "paid", gross = "11200.00", deductions = "0.00", net = "11200.00", paidAt = "2026-10-20T05:30:00Z", paidFrom = "cash_on_hand", receivedAt = "2026-10-20T09:00:00Z"),
            DriverSettlementResponse(id = "s3", number = 15, periodStart = "2026-10-26", periodEnd = "2026-10-29", status = "approved", gross = "9400.00", deductions = "0.00", net = "9400.00"),
        ).sortedByDescending { it.number }

        val state = EarningsUiState(day = day, today = today, week = week, month = month, settlements = settlements)

        val offer = BackhaulEntity(
            id = "b1", tripId = "t1", pickupPlace = "Mysuru Market", dropPlace = "Gundlupet Base", rent = "3500.00",
            hirerName = "Ravi Traders", notes = "Empty crates for the depot", offeredBy = "owner", status = "offered", createdAt = "2026-10-29T09:00:00Z",
        )
    }
}
