package com.morbeez.driver.ui.theme

import android.app.Activity
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import com.morbeez.driver.R

/**
 * "Fresh Ledger" — the same design system as the owner web app
 * (apps/owner-app/src/app/globals.css): a carbon frame, a light workspace,
 * emerald for the brand and lime for what's active. Colours are named for
 * their role, never used raw in a screen.
 */
object Fresh {
    val carbon = Color(0xFF0C1210)
    val carbon2 = Color(0xFF151D19)
    val carbon3 = Color(0xFF1E2823)
    val carbonLine = Color(0xFF24302A)
    val onCarbon = Color(0xFFEEF3EF)
    val onCarbonMuted = Color(0xFF9AA8A0)
    val onCarbonFaint = Color(0xFF66736B)

    val bg = Color(0xFFF3F4F0)
    val surface = Color(0xFFFFFFFF)
    val surface2 = Color(0xFFF1F3EE)
    val surface3 = Color(0xFFE8EBE4)
    val border = Color(0xFFE3E6DE)
    val borderStrong = Color(0xFFCFD4C8)
    val ink = Color(0xFF0E1410)
    val inkMuted = Color(0xFF545E57)
    val inkFaint = Color(0xFF879089)

    val primary = Color(0xFF0F6B43)
    val primaryStrong = Color(0xFF0A5232)
    val primaryTint = Color(0xFFE2F3E8)
    val accent = Color(0xFFC4F25C)
    val accentDeep = Color(0xFF7FD66A)
    val accentInk = Color(0xFF172400)

    val good = Color(0xFF13824C)
    val warning = Color(0xFFA8620A)
    val warningTint = Color(0xFFFDF2DE)
    val critical = Color(0xFFC2412D)
    val criticalTint = Color(0xFFFCE9E5)
    val info = Color(0xFF2A62C9)
    val infoTint = Color(0xFFE7EEFC)
}

@OptIn(ExperimentalTextApi::class)
private fun inter(weight: Int) = Font(
    R.font.inter,
    FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

@OptIn(ExperimentalTextApi::class)
private fun bricolage(weight: Int) = Font(
    R.font.bricolage,
    FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

val InterFamily = FontFamily(inter(400), inter(500), inter(600), inter(700))
val DisplayFamily = FontFamily(bricolage(600), bricolage(700), bricolage(800))

private val typography = Typography(
    displayMedium = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 44.sp, lineHeight = 46.sp, letterSpacing = (-0.04).em),
    displaySmall = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 36.sp, lineHeight = 38.sp, letterSpacing = (-0.035).em),
    headlineLarge = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 34.sp, letterSpacing = (-0.03).em),
    headlineMedium = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 30.sp, letterSpacing = (-0.025).em),
    headlineSmall = TextStyle(fontFamily = DisplayFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 27.sp, letterSpacing = (-0.02).em),
    titleLarge = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, lineHeight = 25.sp, letterSpacing = (-0.01).em),
    titleMedium = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.Normal, fontSize = 14.5.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontFamily = InterFamily, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.1.em),
)

private val colors = lightColorScheme(
    primary = Fresh.primary,
    onPrimary = Color.White,
    primaryContainer = Fresh.primaryTint,
    onPrimaryContainer = Fresh.primaryStrong,
    secondary = Fresh.carbon,
    onSecondary = Fresh.onCarbon,
    secondaryContainer = Fresh.accent,
    onSecondaryContainer = Fresh.accentInk,
    tertiary = Fresh.accent,
    onTertiary = Fresh.accentInk,
    background = Fresh.bg,
    onBackground = Fresh.ink,
    surface = Fresh.surface,
    onSurface = Fresh.ink,
    surfaceVariant = Fresh.surface2,
    onSurfaceVariant = Fresh.inkMuted,
    surfaceContainerLowest = Fresh.surface,
    surfaceContainerLow = Fresh.surface2,
    surfaceContainer = Fresh.surface2,
    surfaceContainerHigh = Fresh.surface3,
    surfaceContainerHighest = Fresh.surface3,
    outline = Fresh.borderStrong,
    outlineVariant = Fresh.border,
    error = Fresh.critical,
    onError = Color.White,
    errorContainer = Fresh.criticalTint,
    onErrorContainer = Fresh.critical,
)

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/**
 * The app's theme. [darkBars] is for screens drawn on the carbon frame, so
 * the status bar's icons stay legible over it.
 */
@Composable
fun MorbeezTheme(darkBars: Boolean = false, content: @Composable () -> Unit) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = (if (darkBars) Fresh.carbon else Fresh.bg).toArgb()
            window.navigationBarColor = (if (darkBars) Fresh.carbon else Fresh.bg).toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkBars
                isAppearanceLightNavigationBars = !darkBars
            }
        }
    }
    MaterialTheme(colorScheme = colors, typography = typography, shapes = shapes, content = content)
}
