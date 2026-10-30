package com.morbeez.driver.ui.screens.records

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Dates and times on the driver's records (D6), in the phone's timezone. */
object RecordsFormat {
    private val day = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
    private val clock = DateTimeFormatter.ofPattern("hh:mm a", Locale.ENGLISH)

    /** The calendar day of an ISO instant; null when unreadable. */
    fun dayOf(iso: String?, zone: ZoneId = ZoneId.systemDefault()): LocalDate? =
        iso?.let { runCatching { Instant.parse(it).atZone(zone).toLocalDate() }.getOrNull() }

    /** "30 Oct 2026", from a YYYY-MM-DD day or an ISO instant. */
    fun date(value: String?, zone: ZoneId = ZoneId.systemDefault()): String? {
        if (value == null) return null
        val d = runCatching { LocalDate.parse(value) }.getOrNull() ?: dayOf(value, zone) ?: return null
        return d.format(day)
    }

    /** "08:12 AM". */
    fun clock(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String? =
        iso?.let { runCatching { Instant.parse(it).atZone(zone).format(clock) }.getOrNull() }

    /** "9h 20m"; "45m" under an hour. */
    fun duration(minutes: Int?): String? = minutes?.let { if (it >= 60) "${it / 60}h ${it % 60}m" else "${it}m" }
}
