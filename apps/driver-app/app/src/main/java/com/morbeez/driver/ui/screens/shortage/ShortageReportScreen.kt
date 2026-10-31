package com.morbeez.driver.ui.screens.shortage

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.hilt.navigation.compose.hiltViewModel
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.FieldScreen
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.PhotoCaptureButton
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.components.rememberLeaveGuard
import com.morbeez.driver.ui.theme.Fresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton

/**
 * Reports delivered/picked-up quantity short of what was planned, or any
 * other reason a stop can't be completed — attach evidence, then skip
 * (Event Catalog, Delivery Shortage Reported).
 */
@Composable
fun ShortageReportScreen(
    tripId: String,
    stopId: String,
    onDone: () -> Unit,
    onBack: (() -> Unit)? = null,
    viewModel: ShortageReportViewModel = hiltViewModel(),
) {
    var photoCaptured by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    // Skipping can't be undone on the phone (D8): a reason first, then a plain "are you sure".
    var confirming by remember { mutableStateOf(false) }
    val leave = rememberLeaveGuard(reason.isNotBlank()) { onBack?.invoke() }

    FieldScreen(
        title = stringResource(R.string.report_problem),
        eyebrow = stringResource(R.string.skip_eyebrow),
        onBack = onBack?.let { leave },
        bottomBar = {
            PrimaryAction(stringResource(R.string.report_and_skip), onClick = { confirming = true }, enabled = reason.isNotBlank(), glyph = Glyph.Warning, danger = true)
        },
    ) {
        Callout(
            stringResource(R.string.skip_intro),
            tone = Tone.Attention,
        )
        FreshTextField(value = reason, onValueChange = { reason = it }, label = stringResource(R.string.what_happened), singleLine = false)
        PhotoCaptureButton(
            label = stringResource(if (photoCaptured) R.string.photo_problem_attached else R.string.photo_problem),
            captured = photoCaptured,
            onCaptured = { path, mimeType ->
                viewModel.captureIssuePhoto(tripId, stopId, path, mimeType)
                photoCaptured = true
            },
        )
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            containerColor = Fresh.surface,
            title = { Text(stringResource(R.string.skip_confirm_title), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = { Text(stringResource(R.string.skip_confirm_text, reason.trim()), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted) },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    viewModel.reportAndSkip(tripId, stopId, reason, onDone)
                }) { Text(stringResource(R.string.report_and_skip), color = Fresh.critical) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) } },
        )
    }
}
