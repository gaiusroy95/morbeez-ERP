package com.morbeez.driver.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.NavType
import androidx.navigation.navArgument
import com.morbeez.driver.data.mode.AppMode
import com.morbeez.driver.data.mode.AppModeStore
import com.morbeez.driver.data.security.TokenStore
import com.morbeez.driver.ui.screens.launcher.LauncherScreen
import com.morbeez.driver.ui.screens.backhaul.AddBackhaulScreen
import com.morbeez.driver.ui.screens.backhaul.BackhaulScreen
import com.morbeez.driver.ui.screens.chat.ChatScreen
import com.morbeez.driver.ui.screens.collect.CollectionsScreen
import com.morbeez.driver.ui.screens.collect.HandoverScreen
import com.morbeez.driver.ui.screens.collect.RecordCollectionScreen
import com.morbeez.driver.ui.screens.collect.ReturnScreen
import com.morbeez.driver.ui.screens.collect.TripSummaryScreen
import com.morbeez.driver.ui.screens.deliver.DeliveryStopScreen
import com.morbeez.driver.ui.screens.deliver.VehicleStockScreen
import com.morbeez.driver.ui.screens.expenses.MyExpensesScreen
import com.morbeez.driver.ui.screens.expenses.NewExpenseScreen
import com.morbeez.driver.ui.screens.home.DrawerLinks
import com.morbeez.driver.ui.screens.earnings.MyEarningsScreen
import com.morbeez.driver.ui.screens.earnings.SettlementsScreen
import com.morbeez.driver.ui.screens.records.ApprovalsScreen
import com.morbeez.driver.ui.screens.requests.RequestScreen
import com.morbeez.driver.ui.screens.records.HelpScreen
import com.morbeez.driver.ui.screens.records.ProfileScreen
import com.morbeez.driver.ui.screens.records.TripDetailsScreen
import com.morbeez.driver.ui.screens.records.TripHistoryScreen
import com.morbeez.driver.ui.screens.records.VehicleScreen
import com.morbeez.driver.ui.screens.farm.FarmStopScreen
import com.morbeez.driver.ui.screens.home.HomeScreen
import com.morbeez.driver.ui.screens.login.LoginScreen
import com.morbeez.driver.ui.screens.login.SetPinScreen
import com.morbeez.driver.ui.screens.route.RouteScreen
import com.morbeez.driver.ui.screens.shortage.ShortageReportScreen
import com.morbeez.driver.ui.screens.startday.StartDayScreen
import com.morbeez.driver.ui.screens.sync.SyncScreen

private object Routes {
    const val LAUNCHER = "launcher"
    const val LOGIN = "login"
    const val SET_PIN = "set-pin"
    const val HOME = "home"
    const val START_DAY = "start-day"
    const val SYNC = "sync"
    const val ROUTE = "route"
    const val FARM_STOP = "trips/{tripId}/farm/{stopId}"
    const val DELIVER = "trips/{tripId}/deliver/{stopId}"
    const val VEHICLE_STOCK = "vehicle-stock"
    const val COLLECTIONS = "collections"
    const val RETURN = "return"
    const val HANDOVER = "handover"
    const val TRIP_SUMMARY = "trip-summary"
    const val BACKHAUL = "backhaul"
    const val ADD_BACKHAUL = "backhaul/new"
    const val COLLECTION = "trips/{tripId}/stops/{stopId}/collect"
    const val ISSUE = "trips/{tripId}/stops/{stopId}/issue"
    const val EXPENSES = "expenses"
    const val NEW_EXPENSE = "expenses/new"
    const val APPROVALS = "approvals"
    const val NEW_REQUEST = "requests/new"
    const val HISTORY = "history"
    const val TRIP_DETAILS = "history/{tripId}"
    const val VEHICLE = "vehicle"
    const val PROFILE = "profile"
    const val HELP = "help"
    const val EARNINGS = "earnings"
    const val SETTLEMENTS = "settlements"
    const val CHAT = "chat"

    fun farmStop(tripId: String, stopId: String) = "trips/$tripId/farm/$stopId"
    fun deliver(tripId: String, stopId: String) = "trips/$tripId/deliver/$stopId"

    /** A farm opens the farmer stop (D2); a shop, its delivery (D3). */
    fun stop(tripId: String, stopId: String, isPickup: Boolean) = if (isPickup) farmStop(tripId, stopId) else deliver(tripId, stopId)
    fun collection(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId/collect"
    fun issue(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId/issue"
    fun tripDetails(tripId: String) = "history/$tripId"
}

/** Back to the list the stop was opened from: the route timeline, or home. */
private fun NavHostController.backToStops() {
    if (!popBackStack(Routes.ROUTE, false)) popBackStack(Routes.HOME, false)
}

/**
 * The launcher is always the bottom of the stack, so Back from either app's
 * first screen returns to it. On a fresh start the app this phone used last
 * opens straight away ([AppModeStore]); the launcher is only seen the first
 * time, or when someone backs out to switch.
 */
@Composable
fun MorbeezNavGraph(
    tokenStore: TokenStore,
    modeStore: AppModeStore,
    onOpenOwner: () -> Unit,
    navController: NavHostController = rememberNavController(),
) {
    fun openDriver() {
        modeStore.lastMode = AppMode.DRIVER
        navController.navigate(if (tokenStore.isLoggedIn()) Routes.HOME else Routes.LOGIN) { launchSingleTop = true }
    }
    fun openOwner() {
        modeStore.lastMode = AppMode.OWNER
        onOpenOwner()
    }

    // Once per fresh start, not on rotation or returning from owner mode.
    var resumedLastMode by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (resumedLastMode) return@LaunchedEffect
        resumedLastMode = true
        when (modeStore.lastMode) {
            AppMode.DRIVER -> openDriver()
            AppMode.OWNER -> openOwner()
            null -> Unit
        }
    }

    NavHost(navController = navController, startDestination = Routes.LAUNCHER) {
        composable(Routes.LAUNCHER) {
            LauncherScreen(onOpenOwner = ::openOwner, onOpenDriver = ::openDriver)
        }

        composable(Routes.LOGIN) {
            LoginScreen(
                onLoggedIn = { offerPin ->
                    navController.navigate(if (offerPin) Routes.SET_PIN else Routes.HOME) { popUpTo(Routes.LOGIN) { inclusive = true } }
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.SET_PIN) {
            SetPinScreen(onDone = { navController.navigate(Routes.HOME) { popUpTo(Routes.SET_PIN) { inclusive = true } } })
        }

        // The driver's home: Dashboard, Procurement, Delivery, the side drawer (Driver app V1, D1).
        composable(Routes.HOME) {
            HomeScreen(
                onStartDay = { navController.navigate(Routes.START_DAY) { launchSingleTop = true } },
                onOpenStop = { tripId, stopId, isPickup -> navController.navigate(Routes.stop(tripId, stopId, isPickup)) },
                onOpenTrip = { navController.navigate(Routes.ROUTE) { launchSingleTop = true } },
                onOpenExpenses = { navController.navigate(Routes.EXPENSES) { launchSingleTop = true } },
                onOpenSync = { navController.navigate(Routes.SYNC) { launchSingleTop = true } },
                onOpenVehicleStock = { navController.navigate(Routes.VEHICLE_STOCK) { launchSingleTop = true } },
                onOpenCollections = { navController.navigate(Routes.COLLECTIONS) { launchSingleTop = true } },
                onReturn = { navController.navigate(Routes.RETURN) { launchSingleTop = true } },
                onHandover = { navController.navigate(Routes.HANDOVER) { launchSingleTop = true } },
                onTripSummary = { navController.navigate(Routes.TRIP_SUMMARY) { launchSingleTop = true } },
                onOpenBackhaul = { navController.navigate(Routes.BACKHAUL) { launchSingleTop = true } },
                onSignedOut = { navController.navigate(Routes.LOGIN) { popUpTo(Routes.HOME) { inclusive = true } } },
                links = DrawerLinks(
                    chat = { navController.navigate(Routes.CHAT) { launchSingleTop = true } },
                    earnings ={ navController.navigate(Routes.EARNINGS) { launchSingleTop = true } },
                    settlements = { navController.navigate(Routes.SETTLEMENTS) { launchSingleTop = true } },
                    history = { navController.navigate(Routes.HISTORY) { launchSingleTop = true } },
                    approvals = { navController.navigate(Routes.APPROVALS) { launchSingleTop = true } },
                    request = { navController.navigate(Routes.NEW_REQUEST) { launchSingleTop = true } },
                    vehicle = { navController.navigate(Routes.VEHICLE) { launchSingleTop = true } },
                    help = { navController.navigate(Routes.HELP) { launchSingleTop = true } },
                    profile = { navController.navigate(Routes.PROFILE) { launchSingleTop = true } },
                ),
            )
        }

        composable(Routes.START_DAY) {
            StartDayScreen(onBack = { navController.popBackStack() }, onStarted = { navController.popBackStack() })
        }

        composable(Routes.SYNC) {
            SyncScreen(onBack = { navController.popBackStack() })
        }

        // The whole route as a timeline: the drawer's Current trip.
        composable(Routes.ROUTE) {
            RouteScreen(
                onOpenStop = { tripId, stopId, isPickup -> navController.navigate(Routes.stop(tripId, stopId, isPickup)) },
                onHandover = { navController.navigate(Routes.HANDOVER) { launchSingleTop = true } },
                onTripSummary = { navController.navigate(Routes.TRIP_SUMMARY) { launchSingleTop = true } },
                onBack = { navController.popBackStack() },
                onOpenSync = { navController.navigate(Routes.SYNC) { launchSingleTop = true } },
            )
        }

        // The farmer stop (driver app V1, D2): accept or reject, pack and weigh, load, hold to complete.
        composable(
            Routes.FARM_STOP,
            arguments = listOf(
                navArgument("tripId") { type = NavType.StringType },
                navArgument("stopId") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            FarmStopScreen(
                onBack = { navController.popBackStack() },
                onDone = { navController.backToStops() },
                onReport = { navController.navigate(Routes.issue(tripId, stopId)) },
                onOpenSync = { navController.navigate(Routes.SYNC) { launchSingleTop = true } },
            )
        }

        // A delivery (driver app V1, D3): to the shop, its QR, the goods line by line, unloaded, photo, crates, hold to complete.
        composable(
            Routes.DELIVER,
            arguments = listOf(
                navArgument("tripId") { type = NavType.StringType },
                navArgument("stopId") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            DeliveryStopScreen(
                onBack = { navController.popBackStack() },
                onDone = { navController.backToStops() },
                onCollect = { navController.navigate(Routes.collection(tripId, stopId)) },
                onReport = { navController.navigate(Routes.issue(tripId, stopId)) },
                onOpenSync = { navController.navigate(Routes.SYNC) { launchSingleTop = true } },
            )
        }

        composable(Routes.VEHICLE_STOCK) {
            VehicleStockScreen(onBack = { navController.popBackStack() })
        }

        // Collections (driver app V1, D4): the customers delivered on the trip, each with what they owe in all.
        composable(Routes.COLLECTIONS) {
            CollectionsScreen(
                onBack = { navController.popBackStack() },
                onCollect = { tripId, stopId -> navController.navigate(Routes.collection(tripId, stopId)) },
                onReturn = { navController.navigate(Routes.RETURN) { launchSingleTop = true } },
            )
        }

        composable(
            Routes.COLLECTION,
            arguments = listOf(
                navArgument("tripId") { type = NavType.StringType },
                navArgument("stopId") { type = NavType.StringType },
            ),
        ) {
            RecordCollectionScreen(onBack = { navController.popBackStack() }, onDone = { navController.popBackStack() })
        }

        // Backhaul (D5): an offer to answer, the job step by step, the payment; one taken on the road.
        composable(Routes.BACKHAUL) {
            BackhaulScreen(
                onBack = { navController.popBackStack() },
                onAdd = { navController.navigate(Routes.ADD_BACKHAUL) { launchSingleTop = true } },
                onReturn = { navController.navigate(Routes.RETURN) { popUpTo(Routes.BACKHAUL) { inclusive = true } } },
            )
        }

        composable(Routes.ADD_BACKHAUL) {
            AddBackhaulScreen(onBack = { navController.popBackStack() }, onDone = { navController.popBackStack() })
        }

        // The end of the trip (D4): Return with the closing KM, the cash handover, the trip summary.
        composable(Routes.RETURN) {
            ReturnScreen(
                onBack = { navController.popBackStack() },
                onDone = { navController.navigate(Routes.HANDOVER) { popUpTo(Routes.RETURN) { inclusive = true } } },
                onBackhaul = { navController.navigate(Routes.BACKHAUL) { launchSingleTop = true } },
            )
        }

        composable(Routes.HANDOVER) {
            HandoverScreen(
                onBack = { navController.popBackStack() },
                onReturn = { navController.navigate(Routes.RETURN) { launchSingleTop = true } },
                onDone = { navController.navigate(Routes.TRIP_SUMMARY) { popUpTo(Routes.HOME) } },
                onBackhaul = { navController.navigate(Routes.BACKHAUL) { launchSingleTop = true } },
            )
        }

        composable(Routes.TRIP_SUMMARY) {
            TripSummaryScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.ISSUE) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            ShortageReportScreen(
                tripId = tripId,
                stopId = stopId,
                onDone = { navController.backToStops() },
                onBack = { navController.popBackStack() },
            )
        }

        // The driver's own records (D6): expenses, approvals, past trips, the vehicle, profile, help.
        composable(Routes.EXPENSES) {
            MyExpensesScreen(onBack = { navController.popBackStack() }, onNew = { navController.navigate(Routes.NEW_EXPENSE) { launchSingleTop = true } })
        }

        composable(Routes.NEW_EXPENSE) {
            NewExpenseScreen(onBack = { navController.popBackStack() }, onDone = { navController.popBackStack() })
        }

        composable(Routes.APPROVALS) {
            ApprovalsScreen(onBack = { navController.popBackStack() }, onNewRequest = { navController.navigate(Routes.NEW_REQUEST) { launchSingleTop = true } })
        }

        // What the driver asks the office for (D10); sent, it waits on Approvals.
        composable(Routes.NEW_REQUEST) {
            RequestScreen(
                onBack = { navController.popBackStack() },
                onSent = {
                    navController.navigate(Routes.APPROVALS) {
                        popUpTo(Routes.APPROVALS) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }

        composable(Routes.HISTORY) {
            TripHistoryScreen(onBack = { navController.popBackStack() }, onOpen = { tripId -> navController.navigate(Routes.tripDetails(tripId)) })
        }

        composable(Routes.TRIP_DETAILS, arguments = listOf(navArgument("tripId") { type = NavType.StringType })) {
            TripDetailsScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.VEHICLE) {
            VehicleScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.PROFILE) {
            ProfileScreen(onBack = { navController.popBackStack() })
        }

        // Earnings and pay (D7): My Earnings, the weekly settlements.
        composable(Routes.EARNINGS) {
            MyEarningsScreen(onBack = { navController.popBackStack() }, onSettlements = { navController.navigate(Routes.SETTLEMENTS) { launchSingleTop = true } })
        }

        composable(Routes.SETTLEMENTS) {
            SettlementsScreen(onBack = { navController.popBackStack() })
        }

        // Chat with the office (D9): messages and photos, about the trip or not; sent when there's signal.
        composable(Routes.CHAT) {
            ChatScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.HELP) {
            HelpScreen(onBack = { navController.popBackStack() }, onOpenSync = { navController.navigate(Routes.SYNC) { launchSingleTop = true } })
        }
    }
}
