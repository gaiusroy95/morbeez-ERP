package com.morbeez.driver.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.morbeez.driver.BuildConfig
import com.morbeez.driver.R
import com.morbeez.driver.data.i18n.AppLanguage
import com.morbeez.driver.data.repository.LogoutResult
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.LanguageDialog
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.components.drawGlow
import com.morbeez.driver.ui.theme.Fresh

/**
 * The side drawer (client spec §1, design sheet "Side drawer"): the driver,
 * vehicle and trip; Operations, Trip, My, Approvals, Other; language,
 * profile and sign-out. What later phases build is listed now, marked
 * "Soon", so the drawer already reads as the finished app.
 */
@Composable
fun DriverDrawer(
    state: HomeUiState,
    onNavigate: (open: () -> Unit) -> Unit,
    onOpenExpenses: (tripId: String) -> Unit,
    onOpenTrip: () -> Unit,
    onOpenSync: () -> Unit,
    onSync: () -> Unit,
    onSignOut: (discardUnsynced: Boolean, onResult: (LogoutResult) -> Unit) -> Unit,
    onSignedOut: () -> Unit,
) {
    val context = LocalContext.current
    val trip = state.trip
    var choosingLanguage by remember { mutableStateOf(false) }
    var confirmingSignOut by remember { mutableStateOf(false) }
    var unsynced by remember { mutableStateOf<Int?>(null) }
    val signedOut: (LogoutResult) -> Unit = { result ->
        if (result is LogoutResult.UnsyncedWork) unsynced = result.count else onSignedOut()
    }

    ModalDrawerSheet(
        drawerContainerColor = Fresh.bg,
        drawerShape = RoundedCornerShape(topEnd = 28.dp, bottomEnd = 28.dp),
        modifier = Modifier.widthIn(max = 320.dp),
    ) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            DrawerHeader(state)
            Section(R.string.drawer_operations) {
                DrawerItem(Glyph.File, stringResource(R.string.expenses), enabled = trip != null) { trip?.let { t -> onNavigate { onOpenExpenses(t.id) } } }
                DrawerItem(Glyph.Rupee, stringResource(R.string.drawer_collections), soon = true)
                DrawerItem(Glyph.Truck, stringResource(R.string.drawer_backhaul), soon = true)
            }
            Section(R.string.drawer_trip) {
                DrawerItem(Glyph.Pin, stringResource(R.string.drawer_current_trip), enabled = trip != null) { onNavigate(onOpenTrip) }
                DrawerItem(Glyph.Clock, stringResource(R.string.drawer_trip_history), soon = true)
            }
            Section(R.string.drawer_my) {
                DrawerItem(Glyph.Wallet, stringResource(R.string.drawer_earnings), soon = true)
                DrawerItem(Glyph.File, stringResource(R.string.drawer_settlements), soon = true)
            }
            Section(R.string.drawer_approvals) {
                DrawerItem(Glyph.Shield, stringResource(R.string.drawer_approvals), soon = true)
            }
            Section(R.string.drawer_other) {
                DrawerItem(Glyph.Car, stringResource(R.string.drawer_vehicle), soon = true)
                DrawerItem(Glyph.Sync, stringResource(R.string.drawer_sync), badge = state.link.waiting.takeIf { it > 0 }) { onNavigate(onOpenSync) }
                DrawerItem(Glyph.Help, stringResource(R.string.drawer_help), soon = true)
            }
            HorizontalDivider(color = Fresh.border, modifier = Modifier.padding(vertical = 6.dp))
            val code = runCatching { AppLanguage.current(context) }.getOrDefault("en")
            val language = AppLanguage.CHOICES.firstOrNull { it.first == code }?.second
            DrawerItem(Glyph.Globe, stringResource(R.string.language), trailing = language) { choosingLanguage = true }
            DrawerItem(Glyph.User, stringResource(R.string.drawer_profile), soon = true)
        }
        HorizontalDivider(color = Fresh.border)
        Row(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .clickable(role = Role.Button) { confirmingSignOut = true }
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlyphIcon(Glyph.Logout, Fresh.critical, size = 22.dp)
            Spacer(Modifier.width(16.dp))
            Text(stringResource(R.string.sign_out), style = MaterialTheme.typography.titleMedium, color = Fresh.critical, modifier = Modifier.weight(1f))
            Text(stringResource(R.string.version, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodySmall, color = Fresh.inkFaint)
        }
    }

    if (choosingLanguage) LanguageDialog(onDismiss = { choosingLanguage = false })

    if (confirmingSignOut) {
        AlertDialog(
            onDismissRequest = { confirmingSignOut = false },
            containerColor = Fresh.surface,
            title = { Text(stringResource(R.string.sign_out_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = { Text(stringResource(R.string.sign_out_text), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingSignOut = false
                    onSignOut(false, signedOut)
                }) { Text(stringResource(R.string.sign_out), color = Fresh.critical) }
            },
            dismissButton = { TextButton(onClick = { confirmingSignOut = false }) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
        )
    }

    // Unsynced work: signing out would erase it (Security Audit SA-12), so it's the driver's explicit choice.
    unsynced?.let { count ->
        AlertDialog(
            onDismissRequest = { unsynced = null },
            containerColor = Fresh.surface,
            title = { Text(stringResource(R.string.unsynced_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = { Text(pluralStringResource(R.plurals.unsynced_text, count, count), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted) },
            confirmButton = {
                TextButton(onClick = {
                    unsynced = null
                    onSync()
                }) { Text(stringResource(R.string.sync_now), color = Fresh.primary) }
            },
            dismissButton = {
                TextButton(onClick = {
                    unsynced = null
                    onSignOut(true, signedOut)
                }) { Text(stringResource(R.string.sign_out_anyway), color = Fresh.critical) }
            },
        )
    }
}

@Composable
private fun DrawerHeader(state: HomeUiState) {
    val name = state.day?.driverName
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(bottomEnd = 28.dp))
            .background(Fresh.carbon)
            .drawBehind { drawGlow() }
            .statusBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Fresh.carbon3), contentAlignment = Alignment.Center) {
                GlyphIcon(Glyph.Leaf, Fresh.accent, size = 24.dp)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text(stringResource(R.string.app_name).uppercase(), style = MaterialTheme.typography.titleLarge, color = Fresh.onCarbon)
                Eyebrow(stringResource(R.string.drawer_app), color = Fresh.onCarbonMuted)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 18.dp)) {
            Box(Modifier.size(56.dp).clip(CircleShape).background(Fresh.carbon3), contentAlignment = Alignment.Center) {
                val initials = DayLogic.initialsOf(name)
                if (initials.isEmpty()) GlyphIcon(Glyph.User, Fresh.accent, size = 26.dp)
                else Text(initials, style = MaterialTheme.typography.headlineSmall, color = Fresh.accent)
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(name ?: stringResource(R.string.driver), style = MaterialTheme.typography.titleLarge, color = Fresh.onCarbon)
                (state.day?.vehicleRegistration ?: state.trip?.vehicleRegistrationNumber)?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = Fresh.onCarbonMuted)
                }
                state.trip?.number?.let {
                    Text(stringResource(R.string.trip_number, it), style = MaterialTheme.typography.bodyMedium, color = Fresh.onCarbonMuted)
                }
                LinkLine(state.link)
            }
        }
    }
}

@Composable
private fun Section(title: Int, content: @Composable ColumnScope.() -> Unit) {
    Eyebrow(stringResource(title), color = Fresh.inkFaint, modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 4.dp))
    Column(content = content)
}

@Composable
private fun DrawerItem(
    glyph: Glyph,
    label: String,
    enabled: Boolean = true,
    soon: Boolean = false,
    badge: Int? = null,
    trailing: String? = null,
    onClick: () -> Unit = {},
) {
    val active = enabled && !soon
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clickable(enabled = active, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlyphIcon(glyph, if (active) Fresh.primary else Fresh.inkFaint, size = 22.dp)
        Spacer(Modifier.width(16.dp))
        Text(label, style = MaterialTheme.typography.titleMedium, color = if (active) Fresh.ink else Fresh.inkFaint, modifier = Modifier.weight(1f))
        when {
            soon -> Pill(stringResource(R.string.soon), Tone.Neutral)
            badge != null -> Pill("$badge", Tone.Attention)
            trailing != null -> Text(trailing, style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        }
        if (active) {
            Spacer(Modifier.width(6.dp))
            GlyphIcon(Glyph.ChevronRight, Fresh.inkFaint, size = 18.dp)
        }
    }
}
