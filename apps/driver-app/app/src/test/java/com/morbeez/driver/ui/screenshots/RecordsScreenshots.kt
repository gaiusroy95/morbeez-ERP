package com.morbeez.driver.ui.screenshots

import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.local.DriverDayEntity
import com.morbeez.driver.data.local.ExpenseEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.remote.dto.ApprovalCountsResponse
import com.morbeez.driver.data.remote.dto.BackhaulPaymentResponse
import com.morbeez.driver.data.remote.dto.BackhaulPhotosResponse
import com.morbeez.driver.data.remote.dto.BackhaulResponse
import com.morbeez.driver.data.remote.dto.CollectedTotals
import com.morbeez.driver.data.remote.dto.CollectionCustomerResponse
import com.morbeez.driver.data.remote.dto.ContactResponse
import com.morbeez.driver.data.remote.dto.DoneOfResponse
import com.morbeez.driver.data.remote.dto.DriverApprovalResponse
import com.morbeez.driver.data.remote.dto.DriverApprovalsResponse
import com.morbeez.driver.data.remote.dto.DriverDocumentResponse
import com.morbeez.driver.data.remote.dto.DriverExpenseResponse
import com.morbeez.driver.data.remote.dto.DriverProfileResponse
import com.morbeez.driver.data.remote.dto.DriverTripCardResponse
import com.morbeez.driver.data.remote.dto.DriverTripSummaryResponse
import com.morbeez.driver.data.remote.dto.DriverVehicleResponse
import com.morbeez.driver.data.remote.dto.FastagBalanceResponse
import com.morbeez.driver.data.remote.dto.FullTankMileageResponse
import com.morbeez.driver.data.remote.dto.MaintenanceDueResponse
import com.morbeez.driver.data.remote.dto.MyExpensesResponse
import com.morbeez.driver.data.remote.dto.PendingTotals
import com.morbeez.driver.data.remote.dto.SummaryTotalsResponse
import com.morbeez.driver.data.remote.dto.SummaryVehicleResponse
import com.morbeez.driver.data.remote.dto.TripClosedResponse
import com.morbeez.driver.data.remote.dto.TripCollectionsResponse
import com.morbeez.driver.data.remote.dto.TripExpenseResponse
import com.morbeez.driver.data.remote.dto.TripHistoryResponse
import com.morbeez.driver.data.remote.dto.TripResponse
import com.morbeez.driver.data.remote.dto.VehicleMileageResponse
import com.morbeez.driver.ui.components.PhotoButtonLook
import com.morbeez.driver.ui.screens.expenses.ExpenseForm
import com.morbeez.driver.ui.screens.expenses.ExpensesUiState
import com.morbeez.driver.ui.screens.expenses.MyExpensesContent
import com.morbeez.driver.ui.screens.expenses.NewExpenseContent
import com.morbeez.driver.ui.screens.farm.PhotoSlot
import com.morbeez.driver.ui.screens.home.HomeShell
import com.morbeez.driver.ui.screens.home.HomeTab
import com.morbeez.driver.ui.screens.home.HomeUiState
import com.morbeez.driver.ui.screens.home.LinkState
import com.morbeez.driver.ui.screens.records.ApprovalsContent
import com.morbeez.driver.ui.screens.records.HelpContent
import com.morbeez.driver.ui.screens.records.HistoryUiState
import com.morbeez.driver.ui.screens.records.ProfileContent
import com.morbeez.driver.ui.screens.records.RecordsUiState
import com.morbeez.driver.ui.screens.records.TripDetailsContent
import com.morbeez.driver.ui.screens.records.TripDetailsUiState
import com.morbeez.driver.ui.screens.records.TripHistoryContent
import com.morbeez.driver.ui.screens.records.VehicleContent
import com.morbeez.driver.ui.screens.requests.RequestContent
import com.morbeez.driver.ui.screens.requests.RequestForm
import com.morbeez.driver.ui.screens.requests.RequestUiState
import com.morbeez.driver.ui.screens.requests.TripCustomer
import com.morbeez.driver.ui.screens.requests.UnsentRequest
import com.morbeez.driver.ui.theme.MorbeezTheme
import org.junit.Rule
import org.junit.Test

/**
 * The D6 screens drawn on the JVM from sample records (design sheets 3 and
 * 4: New Expense, My Expenses, Approvals, Trip History, Trip Details,
 * Vehicle; the drawer's Profile and Help): ./gradlew recordPaparazziDebug.
 */
class RecordsScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private val noCamera: PhotoSlot = { label, captured, _ -> PhotoButtonLook(label, captured) {} }

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    private val expenses = ExpensesUiState(trip = trip, day = day, expenses = tripExpenses, recent = recent, vehicleFuelType = "diesel")

    @Test fun newExpenseFuel() = draw(TALL) {
        NewExpenseContent(
            expenses,
            onBack = {},
            photo = noCamera,
            initial = ExpenseForm(odometer = "48812", fullTank = true, litres = "65.40", rate = "92.50", notes = "IOCL, Gundlupet", billPath = "bill.jpg"),
        ) { _, _ -> }
    }

    // Field hardening (D8): Save reads the expense back before it's sent.
    @Test fun newExpenseReview() = draw {
        NewExpenseContent(
            expenses,
            onBack = {},
            photo = noCamera,
            initial = ExpenseForm(odometer = "48812", fullTank = true, litres = "65.40", rate = "92.50", notes = "IOCL, Gundlupet", billPath = "bill.jpg"),
            initialReview = true,
        ) { _, _ -> }
    }

    @Test fun newExpenseToll() = draw {
        NewExpenseContent(expenses, onBack = {}, photo = noCamera, initial = ExpenseForm(category = "toll", amount = "120", notes = "NH 766, Gundlupet")) { _, _ -> }
    }

    @Test fun newExpenseBelowOpening() = draw(TALL) {
        NewExpenseContent(expenses, onBack = {}, photo = noCamera, initial = ExpenseForm(odometer = "48600", litres = "10", rate = "92.50")) { _, _ -> }
    }

    @Test fun newExpenseMalayalam() = draw(TALL.copy(locale = "ml")) {
        NewExpenseContent(expenses, onBack = {}, photo = noCamera, initial = ExpenseForm(odometer = "48812", litres = "65.40", rate = "92.50", billPath = "bill.jpg")) { _, _ -> }
    }

    // A toll off the vehicle's FASTag: not the driver's cash, and no bill needed.
    @Test fun newExpenseTollByFastag() = draw {
        NewExpenseContent(expenses, onBack = {}, photo = noCamera, initial = ExpenseForm(category = "toll", amount = "235", notes = "Walayar plaza", paidBy = "fastag")) { _, _ -> }
    }

    @Test fun myExpensesThisTrip() = draw(TALL) { MyExpensesContent(expenses, onBack = {}, onNew = {}) }

    @Test fun myExpensesWaitingForOwner() = draw(TALL) {
        MyExpensesContent(expenses.copy(trip = trip.copy(authorityLevel = 2), expenses = tripExpenses.map { if (it.category == "repair") it.copy(needsApproval = true) else it }), onBack = {}, onNew = {})
    }

    @Test fun approvals() = draw(TALL) { ApprovalsContent(records, onBack = {}, onRefresh = {}) }

    @Test fun approvalsOffline() = draw { ApprovalsContent(RecordsUiState(day = day, online = false), onBack = {}, onRefresh = {}) }

    // Asked of the office (D10): one decided, one waiting, one not sent yet.
    @Test fun approvalsWithRequests() = draw(TALL) {
        ApprovalsContent(
            records.copy(
                approvals = DriverApprovalsResponse(
                    "2026-08-30",
                    listOf(
                        DriverApprovalResponse(id = "r1", kind = "advance", status = "pending", amount = "2000.00", detail = "Tyre puncture at Gundlupet, need cash for the repair", tripId = "t1", tripNumber = "T-0042", at = "2026-09-12T09:40:00Z"),
                        DriverApprovalResponse(id = "r2", kind = "new_customer", status = "pending", customerName = "Sri Krishna Stores", detail = "Asked for 20 kg tomato daily", at = "2026-09-12T08:15:00Z"),
                    ),
                    ApprovalCountsResponse(pending = 2, approved = 0, rejected = 0),
                ),
                unsentRequests = listOf(UnsentRequest("k1", "credit_limit", "15000.00", "Hotel Sagar", "Big wedding order this week", 0L, refused = false)),
            ),
            onBack = {},
            onRefresh = {},
        )
    }

    @Test fun askTheOfficeAdvance() = draw {
        RequestContent(RequestUiState(), onBack = {}, onPin = {}, initial = RequestForm(amount = "2000", reason = "Tyre puncture, need cash for the repair")) {}
    }

    @Test fun askTheOfficeNewCustomer() = draw(TALL) {
        RequestContent(
            RequestUiState(),
            onBack = {},
            onPin = {},
            initial = RequestForm(kind = "new_customer", name = "Sri Krishna Stores", phone = "98000 00041", place = "Gundlupet", reason = "Wants 20 kg tomato daily", latitude = 11.80871, longitude = 76.68834),
        ) {}
    }

    @Test fun askTheOfficeCreditLimitReview() = draw {
        RequestContent(
            RequestUiState(customers = listOf(TripCustomer("c1", "Hotel Sagar"), TripCustomer("c2", "Green Mart"))),
            onBack = {},
            onPin = {},
            initial = RequestForm(kind = "credit_limit", customerId = "c1", amount = "15000", reason = "Big wedding order this week"),
            initialReview = true,
        ) {}
    }

    @Test fun askTheOfficeMalayalam() = draw(PHONE.copy(locale = "ml")) {
        RequestContent(RequestUiState(), onBack = {}, onPin = {}, initial = RequestForm(amount = "2000", reason = "ടയർ പഞ്ചർ")) {}
    }

    @Test fun tripHistory() = draw(TALL) { TripHistoryContent(HistoryUiState(loading = false, history = history), onBack = {}, onOpen = {}, onRange = {}) }

    @Test fun tripHistoryOffline() = draw { TripHistoryContent(HistoryUiState(loading = false, history = null), onBack = {}, onOpen = {}, onRange = {}) }

    @Test fun tripDetails() = draw(TALL) { TripDetailsContent(TripDetailsUiState(loading = false, summary = summary), onBack = {}, onRetry = {}) }

    @Test fun vehicle() = draw(TALL) { VehicleContent(records, onBack = {}, onRefresh = {}) }

    @Test fun vehicleFastagLow() = draw(TALL) { VehicleContent(records.copy(vehicle = vehicle.copy(fastag = FastagBalanceResponse("320.00", low = true))), onBack = {}, onRefresh = {}) }

    @Test fun profile() = draw { ProfileContent(records, onBack = {}, onRefresh = {}) }

    @Test fun help() = draw(TALL) { HelpContent(records, onBack = {}, onOpenSync = {}) }

    @Test fun drawerWithApprovals() = draw {
        HomeShell(
            state = HomeUiState(day = day, trip = trip, link = LinkState(), approvalCounts = ApprovalCountsResponse(pending = 3, approved = 12, rejected = 1)),
            tab = HomeTab.DASHBOARD,
            onTab = {},
            drawer = rememberDrawerState(DrawerValue.Open),
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
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 2900)

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
            authorityLevel = 4,
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

        // The design sheet's day: a fill, a toll, loading, a tyre patch, tea not sent yet, parking the owner turned down.
        val tripExpenses = listOf(
            ExpenseEntity("x6", "t1", "parking", "40.00", "Devaraja Market", "2026-10-29T13:40:00Z", needsApproval = true, decision = "rejected", decisionNote = "Park at the depot"),
            ExpenseEntity("x5", "t1", "other", "450.00", "Food & tea", "2026-10-29T14:02:00Z", photos = 1, pendingSync = true),
            ExpenseEntity("x4", "t1", "repair", "1200.00", "Tyre patch", "2026-10-29T10:15:00Z", photos = 1),
            ExpenseEntity("x3", "t1", "labour", "300.00", "Farm loading", "2026-10-29T07:40:00Z", photos = 1),
            ExpenseEntity("x2", "t1", "toll", "120.00", "NH 766, Gundlupet", "2026-10-29T05:54:00Z", photos = 1),
            ExpenseEntity(
                "x1", "t1", "fuel", "6049.50", "IOCL, Gundlupet", "2026-10-29T02:42:00Z",
                odometerKm = 48620, fuelType = "diesel", fullTank = true, litres = "65.400", ratePerLitre = "92.50", photos = 1,
            ),
        )

        val recent = MyExpensesResponse(
            from = "2026-09-30",
            to = "2026-10-29",
            items = listOf(
                DriverExpenseResponse(id = "old1", tripId = "t0", tripNumber = "T-20261028-003", category = "fuel", amount = "4450.00", recordedAt = "2026-10-28T03:10:00Z",
                    fuel = com.morbeez.driver.data.remote.dto.ExpenseFuelResponse(odometerKm = 48000, fuelType = "diesel", fullTank = true, litres = "48.100", ratePerLitre = "92.50"), photos = 1),
            ),
            mileage = VehicleMileageResponse("v1", "KA01D10001", FullTankMileageResponse(48000, 48620, 620, "65.400", "9.48"), "9.35"),
        )

        val approvalItems = listOf(
            DriverApprovalResponse(id = "a1", kind = "expense", status = "pending", amount = "1200.00", category = "fuel", detail = "Diesel, 40 L @ ₹30/L", tripNumber = "T-20261029-004", at = "2026-10-29T05:02:00Z", photos = 1),
            DriverApprovalResponse(id = "a2", kind = "expense", status = "pending", amount = "120.00", category = "toll", detail = "NH 766 — FASTag (manual)", tripNumber = "T-20261029-004", at = "2026-10-29T05:45:00Z", photos = 1),
            DriverApprovalResponse(id = "a3", kind = "collection", status = "pending", amount = "200.00", customerName = "Hotel Sagar", detail = "Two crates of tomato were soft", tripNumber = "T-20261029-004", at = "2026-10-29T08:20:00Z"),
            DriverApprovalResponse(id = "a4", kind = "handover", status = "approved", amount = "45800.00", tripNumber = "T-20261028-003", at = "2026-10-28T13:00:00Z", decidedAt = "2026-10-28T14:00:00Z"),
            DriverApprovalResponse(id = "a5", kind = "expense", status = "rejected", amount = "40.00", category = "parking", tripNumber = "T-20261029-004", at = "2026-10-29T08:10:00Z", decidedAt = "2026-10-29T09:00:00Z", note = "Park at the depot"),
        )

        val vehicle = DriverVehicleResponse(
            id = "v1",
            registrationNumber = "KA01D10001",
            makeModel = "Tata 407",
            manufactureYear = 2023,
            fuelType = "diesel",
            ownership = "owned",
            status = "active",
            currentKm = "48812.0",
            averageKmPerLitre = "9.35",
            lastFullTank = FullTankMileageResponse(48000, 48620, 620, "65.400", "9.48"),
            maintenance = listOf(
                MaintenanceDueResponse(kind = "service", description = "Engine oil change", lastDate = "2026-08-12", lastKm = 46000, nextDueKm = 50000, kmLeft = 1188, state = "due_soon"),
                MaintenanceDueResponse(kind = "repair", description = "Brake pad change", lastDate = "2026-06-02", lastKm = 42000, nextDueKm = 50000, kmLeft = 1188, state = "due_soon"),
                MaintenanceDueResponse(kind = "tyres", description = "Tyre replacement", lastDate = "2026-03-10", lastKm = 30000, nextDueKm = 60000, kmLeft = 11188, state = "ok"),
            ),
            documents = listOf(
                DriverDocumentResponse("puc", "2026-10-07", -22, "expired"),
                DriverDocumentResponse("permit", "2026-11-30", 32, "valid"),
                DriverDocumentResponse("insurance", "2027-03-18", 140, "valid"),
                DriverDocumentResponse("registration", "2030-04-25", 1274, "valid"),
            ),
        )

        val records = RecordsUiState(
            day = day,
            approvals = DriverApprovalsResponse("2026-08-30", approvalItems, ApprovalCountsResponse(pending = 3, approved = 1, rejected = 1)),
            vehicle = vehicle,
            profile = DriverProfileResponse(
                employeeId = "e1",
                name = "Raju Driver",
                phone = "+919800000004",
                joinedOn = "2025-04-01",
                businessName = "Dev Wholesaler Co.",
                vehicle = "KA01D10001",
                contacts = listOf(ContactResponse("+919800000001", "+919800000001")),
            ),
        )

        val card = DriverTripCardResponse(
            id = "t0", number = "T-20261028-003", day = "2026-10-28", status = "reconciled", places = listOf("Gundlupet", "Mysuru", "Gundlupet"),
            procurement = DoneOfResponse(3, 3), delivery = DoneOfResponse(5, 5), collected = "152000.00", backhaulReceived = "3500.00", km = "192.0",
            startedAt = "2026-10-28T02:45:00Z", endedAt = "2026-10-28T12:50:00Z", minutes = 605, fuelLitres = "65.400",
        )

        val history = TripHistoryResponse(
            "2026-09-30",
            "2026-10-29",
            listOf(
                card.copy(id = "t1", number = "T-20261029-004", day = "2026-10-29", status = "in_progress", procurement = DoneOfResponse(3, 3), delivery = DoneOfResponse(2, 5), collected = "48500.00", backhaulReceived = "0.00", km = null, endedAt = null, minutes = null, fuelLitres = "0.000"),
                card,
                card.copy(id = "t9", number = "T-20261027-002", day = "2026-10-27", status = "reconciled", places = listOf("Gundlupet", "Nanjangud", "Mysuru"), delivery = DoneOfResponse(4, 4), collected = "92300.00", backhaulReceived = "2500.00", km = "164.0", minutes = 490, fuelLitres = "58.300"),
            ),
        )

        val summary = DriverTripSummaryResponse(
            card = card,
            trip = TripResponse(
                id = "t0", vehicleId = "v1", driverEmployeeId = "e1", status = "reconciled", plannedDate = "2026-10-28", advanceAmount = "0.00",
                startedAt = "2026-10-28T02:45:00Z", completedAt = "2026-10-28T12:55:00Z", version = 9, number = "T-20261028-003", openingKm = "48620.0", closingKm = "48812.0",
            ),
            vehicle = SummaryVehicleResponse("v1", "KA01D10001", "Tata 407"),
            collections = TripCollectionsResponse(
                tripId = "t0",
                customers = listOf(CollectionCustomerResponse(customerId = "c1", name = "ABC Traders", phone = null, place = "Mysuru", stopId = "s1", terms = "credit", outstanding = "0.00", disputed = "0.00", collectedOnTrip = "48500.00")),
                collected = CollectedTotals(cash = "48500.00", upi = "72000.00", bankTransfer = "31500.00", cheque = "0.00", total = "152000.00"),
                pending = PendingTotals(),
            ),
            backhauls = listOf(
                BackhaulResponse(
                    id = "b1", tripId = "t0", pickupPlace = "Mysuru", dropPlace = "Gundlupet", rent = "3500.00", hirerName = "Arecanut load", notes = null,
                    offeredBy = "owner", status = "completed", skipReason = null, acceptedAt = null, pickupReachedAt = null, loadedAt = null, dropReachedAt = null,
                    completedAt = "2026-10-28T12:20:00Z",
                    payment = BackhaulPaymentResponse("cash", "3500.00", null, null, "2026-10-28T12:25:00Z"), photos = BackhaulPhotosResponse(1, 1, 1), createdAt = "2026-10-28T09:00:00Z",
                ),
            ),
            expenses = listOf(
                TripExpenseResponse("e1", "t0", "fuel", "6049.50", "IOCL, Gundlupet", "u1", "2026-10-28T02:42:00Z", photos = 1),
                TripExpenseResponse("e2", "t0", "toll", "120.00", "NH 766", "u1", "2026-10-28T05:54:00Z", photos = 1),
            ),
            totals = SummaryTotalsResponse(expenses = "6169.50", fuel = "6049.50", tolls = "120.00", kmPerLitre = "2.94"),
            closed = TripClosedResponse("2026-10-28T14:20:00Z", "+919800000001"),
        )
    }
}
