package com.morbeez.driver.ui.screenshots

import androidx.compose.runtime.Composable
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import com.morbeez.driver.data.local.ChatMessageEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.ui.screens.chat.ChatContent
import com.morbeez.driver.ui.screens.chat.ChatUiState
import com.morbeez.driver.ui.theme.MorbeezTheme
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Rule
import org.junit.Test

/**
 * Chat with the office (D9) drawn on the JVM from a sample conversation:
 * ./gradlew recordPaparazziDebug.
 */
class ChatScreenshots {
    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = PHONE, theme = "android:Theme.Material.Light.NoActionBar", maxPercentDifference = 0.1)

    private fun draw(device: DeviceConfig = PHONE, content: @Composable () -> Unit) {
        paparazzi.unsafeUpdateConfig(deviceConfig = device)
        paparazzi.snapshot { MorbeezTheme(darkBars = true) { content() } }
    }

    private fun chat(state: ChatUiState, tab: String = "all", text: String = "", photo: String? = null, device: DeviceConfig = PHONE) = draw(device) {
        ChatContent(
            state = state,
            onBack = {},
            photo = photo,
            onCamera = {},
            onRemovePhoto = {},
            onSend = { _, _ -> },
            initialTab = tab,
            initialText = text,
            zone = ZONE,
            today = TODAY,
        )
    }

    @Test fun conversation() = chat(ChatUiState(messages, trip), device = TALL)

    @Test fun thisTrip() = chat(ChatUiState(messages, trip), tab = "trip", device = TALL)

    @Test fun offlineWithPhoto() = chat(ChatUiState(messages, trip, online = false), tab = "trip", text = "Hotel Sagar is closed — leave the eggs next door?", photo = "/no/such/photo.jpg")

    @Test fun empty() = chat(ChatUiState(emptyList(), null))

    @Test fun malayalam() = chat(ChatUiState(messages, trip), device = TALL.copy(locale = "ml"))

    private companion object {
        val PHONE = DeviceConfig.PIXEL_5
        // Tall enough for the whole sample conversation, both days' lines.
        val TALL = DeviceConfig.PIXEL_5.copy(screenHeight = 4000)
        val ZONE: ZoneId = ZoneId.of("Asia/Kolkata")
        val TODAY: LocalDate = LocalDate.of(2026, 10, 30)

        val trip = TripEntity(
            id = "t1", vehicleId = "v1", vehicleRegistrationNumber = "KA01D10001", driverEmployeeId = "e1", status = "in_progress",
            plannedDate = "2026-10-30", advanceAmount = "0.00", version = 4, number = "T-20261030-002", openingKm = "48650.0",
        )

        private fun office(id: String, at: String, body: String?, tripId: String? = null, photo: String = "none") = ChatMessageEntity(
            id = id, side = "office", senderName = "Meera (office)", body = body, tripId = tripId, tripNumber = tripId?.let { trip.number },
            photo = photo, writtenAt = at, createdAt = at,
        )

        private fun mine(id: String, at: String, body: String?, tripId: String? = null, photo: String = "none", sent: Boolean = true) = ChatMessageEntity(
            id = id, side = "driver", senderName = "Raju Driver", body = body, tripId = tripId, tripNumber = tripId?.let { trip.number },
            photo = photo, writtenAt = at, createdAt = if (sent) at else null, pendingSync = !sent,
        )

        val messages = listOf(
            office("o1", "2026-10-29T12:30:00Z", "Tomorrow load Fresh Mart's 40 crates first."),
            mine("d1", "2026-10-29T12:41:00Z", "OK."),
            mine("d2", "2026-10-30T02:45:00Z", "Started. Loading at the farm now.", tripId = "t1"),
            office("o2", "2026-10-30T03:10:00Z", "Good. The birds are booked at 92.50 a kilo.", tripId = "t1"),
            mine("d3", "2026-10-30T05:20:00Z", "Crates at Fresh Mart — 3 broken.", tripId = "t1", photo = "pending"),
            office("o3", "2026-10-30T05:40:00Z", "Note it on the delivery. Here's the slip they signed last week.", tripId = "t1", photo = "ready"),
            mine("d4", "2026-10-30T06:05:00Z", "Reached Hotel Sagar.", tripId = "t1", sent = false),
        )
    }
}
