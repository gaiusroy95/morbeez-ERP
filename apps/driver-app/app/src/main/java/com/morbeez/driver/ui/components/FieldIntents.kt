package com.morbeez.driver.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Handing off to the phone's own apps: the dialler, and maps for navigation. */
object FieldIntents {
    /** Opens the dialler with [phone] filled in; the driver presses call. No permission needed. */
    fun dial(context: Context, phone: String): Boolean =
        start(context, Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone.filter { it.isDigit() || it == '+' })))

    /**
     * Turn-by-turn in Google Maps to the stop's pin; any maps app otherwise;
     * the address when there's no pin (Driver app V1 plan: "Navigate" opens
     * Google Maps with the stop's pin). False when nothing could open it.
     */
    fun navigate(context: Context, latitude: Double?, longitude: Double?, label: String, address: String?): Boolean {
        val candidates = buildList {
            if (latitude != null && longitude != null) {
                val at = "$latitude,$longitude"
                add(Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$at")).setPackage("com.google.android.apps.maps"))
                add(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$at?q=$at(${Uri.encode(label)})")))
                add(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$at")))
            } else if (!address.isNullOrBlank()) {
                add(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=${Uri.encode(address)}")))
                add(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=${Uri.encode(address)}")))
            }
        }
        return candidates.any { start(context, it) }
    }

    private fun start(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (_: SecurityException) {
        false
    }
}
