package com.morbeez.driver.data.sync

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Shrinks a camera photo in place before it's queued (Performance Audit
 * PA-12): the camera writes 3–6 MB, which takes minutes to send on a rural
 * uplink and eats the driver's data. About 1600 px on the long side at JPEG
 * quality 80 (~250 KB) is still plenty to read a signature or a crate count.
 * The file keeps its path; only its contents change. A photo that can't be
 * decoded is left untouched — better a big upload than a lost one.
 */
object PhotoShrinker {
    private const val MAX_SIDE = 1600
    private const val QUALITY = 80

    suspend fun shrink(path: String) = withContext(Dispatchers.IO) {
        val file = File(path)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        val longSide = maxOf(bounds.outWidth, bounds.outHeight)
        if (longSide <= 0) return@withContext

        // Decode at the nearest power of two above the target, then scale exactly.
        var sample = 1
        while (longSide / (sample * 2) >= MAX_SIDE) sample *= 2
        val decoded = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return@withContext

        val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(decoded.width, decoded.height))
        val matrix = Matrix().apply {
            postScale(scale, scale)
            // Re-encoding drops EXIF, so apply the camera's rotation to the pixels instead.
            postRotate(rotationOf(path).toFloat())
        }
        val out = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
        if (out !== decoded) out.recycle()
        decoded.recycle()
        tmp.renameTo(file)
    }

    private fun rotationOf(path: String): Int = when (
        runCatching { ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            .getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    ) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
    }
}
