package com.morbeez.driver.ui.components

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import java.io.ByteArrayOutputStream

/**
 * A minimal finger-drawn signature capture — exported as a base64 PNG for
 * CompleteDeliveryDto.signatureData (Driver App Architecture, DRV.19). A
 * 'pod'-type photo (PhotoCaptureButton) is the alternative proof the
 * backend also accepts; this doesn't have to be the only path. Each
 * stroke is a SnapshotStateList<Offset> — appending a point is what
 * actually notifies Compose to redraw; mutating a Path object in place
 * would not.
 */
@Composable
fun SignaturePad(
    onSigned: (base64Png: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val strokes = remember { mutableStateListOf<MutableList<Offset>>() }

    Column(modifier = modifier) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp)
                .background(ComposeColor.White)
                .border(1.dp, ComposeColor.Gray)
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            strokes.add(mutableStateListOf(offset))
                        },
                        onDrag = { change, _ ->
                            strokes.lastOrNull()?.add(change.position)
                        },
                    )
                },
        ) {
            strokes.forEach { points ->
                if (points.size < 2) return@forEach
                val path = Path().apply {
                    moveTo(points.first().x, points.first().y)
                    points.drop(1).forEach { lineTo(it.x, it.y) }
                }
                drawPath(path, color = ComposeColor.Black, style = Stroke(width = 4f))
            }
        }

        Column {
            OutlinedButton(onClick = { strokes.clear() }) {
                Text("Clear")
            }
            Button(onClick = { onSigned(renderToBase64Png(strokes, widthPx = 800, heightPx = 360)) }) {
                Text("Use signature")
            }
        }
    }
}

private fun renderToBase64Png(strokes: List<List<Offset>>, widthPx: Int, heightPx: Int): String {
    val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    canvas.drawColor(Color.WHITE)
    val paint = Paint().apply {
        color = Color.BLACK
        style = Paint.Style.STROKE
        strokeWidth = 6f
        isAntiAlias = true
    }
    strokes.forEach { points ->
        for (i in 0 until points.size - 1) {
            canvas.drawLine(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, paint)
        }
    }
    val output = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
    return "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
}
