package com.morbeez.driver.ui.components

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.morbeez.driver.ui.theme.Fresh
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
    captured: Boolean = false,
) {
    val context = LocalContext.current
    var pendingFile: File? by remember { mutableStateOf(null) }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val file = pendingFile
        if (success && file != null) {
            onCaptured(file.absolutePath, "image/jpeg")
        }
    }

    val shape = RoundedCornerShape(18.dp)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (captured) Fresh.primaryTint else Fresh.surface)
            .border(1.dp, if (captured) Fresh.primary else Fresh.borderStrong, shape)
            .clickable(role = Role.Button) {
                val file = createCaptureFile(context)
                pendingFile = file
                val uri = FileProvider.getUriForFile(context, "com.morbeez.driver.fileprovider", file)
                launcher.launch(uri)
            }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(if (captured) Fresh.primary else Fresh.carbon),
            contentAlignment = Alignment.Center,
        ) {
            GlyphIcon(if (captured) Glyph.Check else Glyph.Camera, if (captured) Fresh.surface else Fresh.accent, size = 22.dp)
        }
        Spacer(Modifier.width(14.dp))
        Text(
            label,
            style = MaterialTheme.typography.titleSmall,
            color = Fresh.ink,
            modifier = Modifier.weight(1f),
        )
        if (captured) Text(stringResource(R.string.retake), style = MaterialTheme.typography.labelMedium, color = Fresh.primary)
    }
}

private fun createCaptureFile(context: Context): File {
    val dir = File(context.cacheDir, "photos").apply { mkdirs() }
    return File(dir, "${UUID.randomUUID()}.jpg")
}
