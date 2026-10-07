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
import com.morbeez.driver.ui.screens.delivery.DeliveryScreen
import com.morbeez.driver.ui.screens.expenses.ExpensesScreen
import com.morbeez.driver.ui.screens.login.LoginScreen
import com.morbeez.driver.ui.screens.login.SetPinScreen
import com.morbeez.driver.ui.screens.route.RouteScreen
import com.morbeez.driver.ui.screens.shortage.ShortageReportScreen
import com.morbeez.driver.ui.screens.stopdetail.StopDetailScreen

private object Routes {
    const val LAUNCHER = "launcher"
    const val LOGIN = "login"
    const val SET_PIN = "set-pin"
    const val ROUTE = "route"
    const val STOP_DETAIL = "trips/{tripId}/stops/{stopId}"
    const val DELIVERY = "trips/{tripId}/stops/{stopId}/delivery"
    const val COLLECTION = "trips/{tripId}/stops/{stopId}/collect"
    const val ISSUE = "trips/{tripId}/stops/{stopId}/issue"
    const val EXPENSES = "trips/{tripId}/expenses"

    fun stopDetail(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId"
    fun delivery(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId/delivery"
    fun collection(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId/collect"
    fun issue(tripId: String, stopId: String) = "trips/$tripId/stops/$stopId/issue"
    fun expenses(tripId: String) = "trips/$tripId/expenses"
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
        navController.navigate(if (tokenStore.isLoggedIn()) Routes.ROUTE else Routes.LOGIN) { launchSingleTop = true }
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
                    navController.navigate(if (offerPin) Routes.SET_PIN else Routes.ROUTE) { popUpTo(Routes.LOGIN) { inclusive = true } }
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.SET_PIN) {
            SetPinScreen(onDone = { navController.navigate(Routes.ROUTE) { popUpTo(Routes.SET_PIN) { inclusive = true } } })
        }

        composable(Routes.ROUTE) {
            RouteScreen(
                onOpenStop = { tripId, stopId -> navController.navigate(Routes.stopDetail(tripId, stopId)) },
                onOpenExpenses = { tripId -> navController.navigate(Routes.expenses(tripId)) },
            )
        }

        composable(
            Routes.STOP_DETAIL,
            arguments = listOf(
                navArgument("tripId") { type = NavType.StringType },
                navArgument("stopId") { type = NavType.StringType },
            ),
        ) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            StopDetailScreen(
                tripId = tripId,
                stopId = stopId,
                onOpenDelivery = { navController.navigate(Routes.delivery(tripId, stopId)) },
                onOpenCollection = { navController.navigate(Routes.collection(tripId, stopId)) },
                onOpenIssueReport = { navController.navigate(Routes.issue(tripId, stopId)) },
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.DELIVERY) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            DeliveryScreen(
                tripId = tripId,
                stopId = stopId,
                onDone = { navController.popBackStack(Routes.ROUTE, false) },
                onBack = { navController.popBackStack() },
            )
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
                onDone = { navController.popBackStack(Routes.ROUTE, false) },
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.EXPENSES) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            ExpensesScreen(tripId = tripId, onBack = { navController.popBackStack() })
        }
    }
}
