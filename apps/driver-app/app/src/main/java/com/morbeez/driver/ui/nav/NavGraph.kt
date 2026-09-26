package com.morbeez.driver.ui.nav

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.NavType
import androidx.navigation.navArgument
import com.morbeez.driver.data.security.TokenStore
import com.morbeez.driver.ui.screens.cash.CashCollectionScreen
import com.morbeez.driver.ui.screens.delivery.DeliveryScreen
import com.morbeez.driver.ui.screens.expenses.ExpensesScreen
import com.morbeez.driver.ui.screens.login.LoginScreen
import com.morbeez.driver.ui.screens.route.RouteScreen
import com.morbeez.driver.ui.screens.shortage.ShortageReportScreen
import com.morbeez.driver.ui.screens.stopdetail.StopDetailScreen

private object Routes {
    const val LOGIN = "login"
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

@Composable
fun MorbeezNavGraph(tokenStore: TokenStore, navController: NavHostController = rememberNavController()) {
    val startDestination = if (tokenStore.isLoggedIn()) Routes.ROUTE else Routes.LOGIN

    NavHost(navController = navController, startDestination = startDestination) {
        composable(Routes.LOGIN) {
            LoginScreen(onLoggedIn = {
                navController.navigate(Routes.ROUTE) { popUpTo(Routes.LOGIN) { inclusive = true } }
            })
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
            DeliveryScreen(tripId = tripId, stopId = stopId, onDone = { navController.popBackStack(Routes.ROUTE, false) })
        }

        composable(Routes.COLLECTION) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            CashCollectionScreen(tripId = tripId, stopId = stopId, onDone = { navController.popBackStack() })
        }

        composable(Routes.ISSUE) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            val stopId = backStackEntry.arguments?.getString("stopId").orEmpty()
            ShortageReportScreen(
                tripId = tripId,
                stopId = stopId,
                onDone = { navController.popBackStack(Routes.ROUTE, false) },
            )
        }

        composable(Routes.EXPENSES) { backStackEntry ->
            val tripId = backStackEntry.arguments?.getString("tripId").orEmpty()
            ExpensesScreen(tripId = tripId)
        }
    }
}
