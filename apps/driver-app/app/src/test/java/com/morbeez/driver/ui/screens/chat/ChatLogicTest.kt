package com.morbeez.driver.ui.screens.chat

import com.morbeez.driver.data.local.ChatMessageEntity
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatLogicTest {
    private fun message(id: String, side: String, writtenAt: String, createdAt: String?, tripId: String? = null) =
        ChatMessageEntity(id = id, side = side, senderName = "x", body = id, tripId = tripId, writtenAt = writtenAt, createdAt = createdAt, pendingSync = createdAt == null)

    private val conversation = listOf(
        message("o1", "office", "2026-10-29T12:30:00Z", "2026-10-29T12:30:01.000Z"),
        message("d1", "driver", "2026-10-30T02:45:00Z", "2026-10-30T02:45:02.000Z", tripId = "t1"),
        message("o2", "office", "2026-10-30T03:10:00Z", "2026-10-30T03:10:00.500Z", tripId = "t1"),
        // Written offline, not sent yet.
        message("d2", "driver", "2026-10-30T06:05:00Z", null, tripId = "t1"),
    )

    @Test
    fun `unread — what the office wrote after the driver's mark, never their own`() {
        assertEquals(2, ChatLogic.unreadOf(conversation, null))
        assertEquals(1, ChatLogic.unreadOf(conversation, "2026-10-29T12:30:01.000Z"))
        assertEquals(0, ChatLogic.unreadOf(conversation, "2026-10-30T03:10:00.500Z"))
        // Counted by when the server had it, whatever the instant's precision.
        assertEquals(1, ChatLogic.unreadOf(conversation, "2026-10-30T03:10:00Z"))
    }

    @Test
    fun `opening reads up to the latest the server had — an unsent message isn't on it`() {
        assertEquals("2026-10-30T03:10:00.500Z", ChatLogic.latestOf(conversation))
        assertNull(ChatLogic.latestOf(listOf(conversation[3])))
    }

    @Test
    fun `the mark never goes back`() {
        assertEquals("2026-10-30T03:10:00Z", ChatLogic.laterOf("2026-10-30T03:10:00Z", "2026-10-29T12:30:01.000Z"))
        assertEquals("2026-10-30T03:10:00Z", ChatLogic.laterOf(null, "2026-10-30T03:10:00Z"))
        assertEquals("2026-10-30T03:10:00Z", ChatLogic.laterOf("2026-10-30T03:10:00Z", null))
        assertNull(ChatLogic.laterOf(null, null))
    }

    @Test
    fun `This trip shows what's about it, All shows everything`() {
        assertEquals(listOf("d1", "o2", "d2"), ChatLogic.shown(conversation, "t1").map { it.id })
        assertEquals(4, ChatLogic.shown(conversation, null).size)
    }

    @Test
    fun `the days fall in the phone's time zone`() {
        val days = ChatLogic.byDay(conversation, ZoneId.of("Asia/Kolkata"))
        assertEquals(listOf(LocalDate.of(2026, 10, 29), LocalDate.of(2026, 10, 30)), days.map { it.first })
        assertEquals(listOf("d1", "o2", "d2"), days[1].second.map { it.id })
        // 18:30 UTC is past midnight in India.
        val late = ChatLogic.byDay(listOf(message("o3", "office", "2026-10-29T18:45:00Z", "2026-10-29T18:45:00Z")), ZoneId.of("Asia/Kolkata"))
        assertEquals(LocalDate.of(2026, 10, 30), late.single().first)
    }

    @Test
    fun `something to say, or a photo`() {
        assertFalse(ChatLogic.canSend("   ", hasPhoto = false))
        assertTrue(ChatLogic.canSend("", hasPhoto = true))
        assertTrue(ChatLogic.canSend("Reached", hasPhoto = false))
    }
}
