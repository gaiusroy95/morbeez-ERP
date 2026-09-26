package com.morbeez.driver.ui.components

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/**
 * A camera-capture button used by Delivery (POD), Pickup, and Report Issue
 * — Photos is a capability every stop can use, not a screen of its own
 * (Driver App Architecture, DRV.19). Writes into the app's own cache dir
 * via FileProvider; the caller queues the resulting file path for upload
 * (TripRepository.queuePhoto).
 */
@Composable
fun PhotoCaptureButton(
    label: String,
    onCaptured: (localPath: String, mimeType: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var pendingFile: File? by remember { mutableStateOf(null) }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingFile
        if (success && file != null) {
            onCaptured(file.absolutePath, "image/jpeg")
        }
    }

    Column(modifier = modifier.padding(vertical = 4.dp)) {
        Button(onClick = {
            val file = createCaptureFile(context)
            pendingFile = file
            val uri = FileProvider.getUriForFile(context, "com.morbeez.driver.fileprovider", file)
            launcher.launch(uri)
        }) {
            Text(label)
        }
    }
}

private fun createCaptureFile(context: Context): File {
    val dir = File(context.cacheDir, "photos").apply { mkdirs() }
    return File(dir, "${UUID.randomUUID()}.jpg")
}
