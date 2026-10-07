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

    FieldScreen(
        title = stringResource(R.string.report_problem),
        eyebrow = stringResource(R.string.skip_eyebrow),
        onBack = onBack,
        bottomBar = {
            PrimaryAction(stringResource(R.string.report_and_skip), onClick = { viewModel.reportAndSkip(tripId, stopId, reason, onDone) }, glyph = Glyph.Warning, danger = true)
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
}
