package com.morbeez.driver.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.morbeez.driver.R
import com.morbeez.driver.ui.theme.Fresh

// Field hardening (D8): nothing typed on the road is lost to a stray Back,
// and what the office refused is said where the driver is.

/**
 * Leaving a form with something typed in it asks first — system Back and the
 * screen's own back arrow alike. Returns the back action to give the screen.
 */
@Composable
fun rememberLeaveGuard(dirty: Boolean, onLeave: () -> Unit): () -> Unit {
    var asking by remember { mutableStateOf(false) }
    BackHandler(enabled = dirty) { asking = true }
    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false },
            containerColor = Fresh.surface,
            title = { Text(stringResource(R.string.leave_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = { Text(stringResource(R.string.leave_text), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted) },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    onLeave()
                }) { Text(stringResource(R.string.leave_anyway), color = Fresh.critical) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text(stringResource(R.string.keep_editing), color = Fresh.primary) } },
        )
    }
    return { if (dirty) asking = true else onLeave() }
}

/**
 * The office refused something done here (Driver App Architecture DRV.8): a
 * plain strip above the screen with its words and the way to Sync, where
 * the driver corrects it or removes it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WithRefusal(reason: String?, onOpenSync: () -> Unit, content: @Composable () -> Unit) {
    if (reason == null) {
        content()
        return
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Fresh.critical)
                .statusBarsPadding()
                .clickable(role = Role.Button, onClick = onOpenSync)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GlyphIcon(Glyph.Warning, Color.White, size = 18.dp)
            Spacer(Modifier.width(10.dp))
            Text(
                stringResource(R.string.stop_refused, reason.ifBlank { stringResource(R.string.removed_no_reason) }),
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.open_sync), style = MaterialTheme.typography.labelLarge, color = Color.White)
        }
        Box(Modifier.weight(1f).consumeWindowInsets(WindowInsets.statusBars)) { content() }
    }
}
