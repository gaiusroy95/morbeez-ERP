package com.morbeez.driver.ui.screens.chat

import com.morbeez.driver.data.local.ChatMessageEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * The conversation with the office (D9), worked out on the phone: what's
 * unread, how far opening it reads, what a trip's tab shows, and the days
 * the messages fall on. Times are ISO instants as the server wrote them.
 */
object ChatLogic {
    /** What a message may say at most — the server's limit. */
    const val MAX_LENGTH = 2000

    private fun instantOf(iso: String?): Instant? = iso?.let { runCatching { Instant.parse(it) }.getOrNull() }

    /** The later of two instants; either may be missing. */
    fun laterOf(a: String?, b: String?): String? {
        val x = instantOf(a) ?: return b
        val y = instantOf(b) ?: return a
        return if (y.isAfter(x)) b else a
    }

    /** The office's messages the driver hasn't read: those the server had after [readAt]. */
    fun unreadOf(messages: List<ChatMessageEntity>, readAt: String?): Int {
        val mark = instantOf(readAt)
        return messages.count { m ->
            if (m.side != "office") return@count false
            val at = instantOf(m.createdAt) ?: return@count false
            mark == null || at.isAfter(mark)
        }
    }

    /** The latest the server had: how far opening the conversation reads. */
    fun latestOf(messages: List<ChatMessageEntity>): String? =
        messages.mapNotNull { it.createdAt }.fold(null as String?) { latest, at -> laterOf(latest, at) }

    /** Everything, or only what's about [tripId]. */
    fun shown(messages: List<ChatMessageEntity>, tripId: String?): List<ChatMessageEntity> =
        if (tripId == null) messages else messages.filter { it.tripId == tripId }

    /** The messages by the day they were written, in [zone]: the conversation's date lines. */
    fun byDay(messages: List<ChatMessageEntity>, zone: ZoneId): List<Pair<LocalDate, List<ChatMessageEntity>>> =
        messages.groupBy { m -> (instantOf(m.writtenAt) ?: Instant.EPOCH).atZone(zone).toLocalDate() }.toList()

    /** Something written, or a photo. */
    fun canSend(body: String, hasPhoto: Boolean): Boolean = body.isNotBlank() || hasPhoto
}
