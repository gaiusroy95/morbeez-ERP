package com.morbeez.driver.ui.screens.shortage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.hilt.navigation.compose.hiltViewModel
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.FieldScreen
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

    FieldScreen(
        title = "Report a problem",
        eyebrow = "Skip this stop",
        onBack = onBack,
        bottomBar = {
            PrimaryAction("Report and skip this stop", onClick = { viewModel.reportAndSkip(tripId, stopId, onDone) }, glyph = Glyph.Warning, danger = true)
        },
    ) {
        Callout(
            "Photograph the shortage, spoilage, or whatever stops this stop being done as planned. The office sees it straight away.",
            tone = Tone.Attention,
        )
        PhotoCaptureButton(
            label = if (photoCaptured) "Photo of the problem attached" else "Photograph the problem",
            captured = photoCaptured,
            onCaptured = { path, mimeType ->
                viewModel.captureIssuePhoto(tripId, stopId, path, mimeType)
                photoCaptured = true
            },
        )
    }
}
