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
import com.morbeez.driver.ui.screens.cash.CashCollectionScreen
import com.morbeez.driver.ui.screens.deliver.DeliveryStopScreen
import com.morbeez.driver.ui.screens.deliver.VehicleStockScreen
import com.morbeez.driver.ui.screens.expenses.ExpensesScreen
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
    const val COLLECTION = "trips/{tripId}/stops/{stopId}/collect"
    const val ISSUE = "trips/{tripId}/stops/{stopId}/issue"
    const val EXPENSES = "trips/{tripId}/expenses"

    fun farmStop(tripId: String, stopId: String) = "trips/$tripId/farm/$stopId"
    fun deliver(tripId: String, stopId: String) = "trips/$tripId/deliver/$stopId"

    /** A farm opens the farmer stop (D2); a shop, its delivery (D3). */
    fun stop(tripId: String, stopId: String, isPickup: Boolean) = if (isPickup) farmStop(tripId, stopId) else deliver(tripId, stopId)
    fun collection(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId/collect"
    fun issue(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId/issue"
    fun expenses(tripId: String) = "trips/$tripId/expenses"
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
                onOpenExpenses = { tripId -> navController.navigate(Routes.expenses(tripId)) },
                onOpenSync = { navController.navigate(Routes.SYNC) { launchSingleTop = true } },
                onOpenVehicleStock = { navController.navigate(Routes.VEHICLE_STOCK) { launchSingleTop = true } },
                onSignedOut = { navController.navigate(Routes.LOGIN) { popUpTo(Routes.HOME) { inclusive = true } } },
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
                onOpenExpenses = { tripId -> navController.navigate(Routes.expenses(tripId)) },
                onBack = { navController.popBackStack() },
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
            )
        }

        composable(Routes.VEHICLE_STOCK) {
            VehicleStockScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.COLLECTION) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            CashCollectionScreen(
                tripId = tripId,
                stopId = stopId,
                onDone = { navController.popBackStack() },
                onBack = { navController.popBackStack() },
            )
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

        composable(Routes.EXPENSES) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            ExpensesScreen(tripId = tripId, onBack = { navController.popBackStack() })
        }
    }
}
