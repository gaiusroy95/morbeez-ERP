package com.morbeez.driver.ui.screens.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.morbeez.driver.R
import com.morbeez.driver.data.local.ChatMessageEntity
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.CarbonHeader
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.Pill
import com.morbeez.driver.ui.components.SegmentTabs
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.components.rememberCamera
import com.morbeez.driver.ui.screens.records.RecordsFormat
import com.morbeez.driver.ui.theme.Fresh
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** How often the open conversation asks for the office's replies. */
private const val PULL_EVERY_MS = 15_000L

@Composable
fun ChatScreen(onBack: () -> Unit, viewModel: ChatViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var photo by rememberSaveable { mutableStateOf<String?>(null) }
    val openCamera = rememberCamera { path, _ -> photo = path }

    // Open and on screen: the office's replies come down, and what's there is read.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                viewModel.pull()
                delay(PULL_EVERY_MS)
            }
        }
    }
    val latest = ChatLogic.latestOf(state.messages)
    LaunchedEffect(latest) { if (latest != null) viewModel.markRead() }

    ChatContent(
        state = state,
        onBack = onBack,
        photo = photo,
        onCamera = openCamera,
        onRemovePhoto = { photo = null },
        onSend = { body, aboutTrip ->
            viewModel.send(body, aboutTrip, photo)
            photo = null
        },
    )
}

/**
 * Chat with the office (D9; the client's answer 9): one conversation with
 * the business, each message perhaps about the trip — "This trip" shows
 * those, and what's written there is about it. Written with no signal, a
 * message waits on the phone (a clock) and goes when there's signal (a tick);
 * a photo follows its message.
 */
@Composable
internal fun ChatContent(
    state: ChatUiState,
    onBack: () -> Unit,
    photo: String?,
    onCamera: () -> Unit,
    onRemovePhoto: () -> Unit,
    onSend: (body: String, aboutTrip: Boolean) -> Unit,
    initialTab: String = "all",
    initialText: String = "",
    zone: ZoneId = ZoneId.systemDefault(),
    today: LocalDate = LocalDate.now(zone),
) {
    val trip = state.trip
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    var text by rememberSaveable { mutableStateOf(initialText) }
    val aboutTrip = tab == "trip" && trip != null
    val shown = ChatLogic.shown(state.messages, if (aboutTrip) trip?.id else null)

    Column(Modifier.fillMaxSize().background(Fresh.bg).imePadding()) {
        CarbonHeader(
            title = stringResource(R.string.chat_title),
            eyebrow = trip?.number?.let { stringResource(R.string.trip_number, it) },
            onBack = onBack,
        )
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (trip != null) {
                SegmentTabs(
                    listOf("all" to stringResource(R.string.chat_all), "trip" to stringResource(R.string.chat_this_trip)),
                    tab,
                    { tab = it },
                )
            }
            if (!state.online) Callout(stringResource(R.string.chat_offline), Tone.Attention, Glyph.Tower)
        }

        if (shown.isEmpty()) {
            Column(
                Modifier.weight(1f).fillMaxWidth().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                GlyphIcon(Glyph.Chat, Fresh.inkFaint, size = 40.dp)
                Spacer(Modifier.height(12.dp))
                Text(
                    stringResource(if (aboutTrip) R.string.chat_empty_trip else R.string.chat_empty),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Fresh.inkMuted,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            // Newest at the bottom, where the thumb and the keyboard are.
            val rows = ChatLogic.byDay(shown, zone).flatMap { (day, messages) -> listOf<Any>(day) + messages }.reversed()
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                reverseLayout = true,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(rows, key = { row -> if (row is ChatMessageEntity) row.id else "day-$row" }) { row ->
                    when (row) {
                        is LocalDate -> DayLine(row, today)
                        is ChatMessageEntity -> Bubble(row, zone, showTrip = !aboutTrip)
                    }
                }
            }
        }

        Composer(
            text = text,
            onText = { text = it.take(ChatLogic.MAX_LENGTH) },
            tripNumber = trip?.number?.takeIf { aboutTrip },
            photo = photo,
            onCamera = onCamera,
            onRemovePhoto = onRemovePhoto,
            onSend = {
                onSend(text, aboutTrip)
                text = ""
            },
        )
    }
}

@Composable
private fun DayLine(day: LocalDate, today: LocalDate) {
    val label = when (day) {
        today -> stringResource(R.string.chat_today)
        today.minusDays(1) -> stringResource(R.string.chat_yesterday)
        else -> RecordsFormat.date(day.toString()).orEmpty()
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = Fresh.inkMuted,
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Fresh.surface3).padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun Bubble(m: ChatMessageEntity, zone: ZoneId, showTrip: Boolean) {
    val mine = m.side == "driver"
    val shape = if (mine) RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp) else RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)
    Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .clip(shape)
                .background(if (mine) Fresh.primaryTint else Fresh.surface)
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            if (!mine) Text(m.senderName, style = MaterialTheme.typography.labelLarge, color = Fresh.primary)
            if (m.photo != "none") ChatPhoto(m.localPhotoPath)
            m.body?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = Fresh.ink) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.align(Alignment.End)) {
                if (showTrip && m.tripNumber != null) Pill(stringResource(R.string.trip_number, m.tripNumber), Tone.Active)
                Text(RecordsFormat.clock(m.writtenAt, zone).orEmpty(), style = MaterialTheme.typography.labelSmall, color = Fresh.inkFaint)
                if (mine) {
                    // A clock while it waits for signal; a tick once the office has it.
                    GlyphIcon(if (m.pendingSync) Glyph.Clock else Glyph.Check, if (m.pendingSync) Fresh.inkFaint else Fresh.primary, size = 14.dp)
                }
            }
            if (mine && !m.pendingSync && m.photo == "pending") {
                Text(stringResource(R.string.chat_photo_sending), style = MaterialTheme.typography.labelSmall, color = Fresh.inkFaint)
            }
        }
    }
}

/** A message's photo: from the phone; until the office's arrives, a placeholder. */
@Composable
private fun ChatPhoto(path: String?) {
    val bitmap by produceState<Bitmap?>(null, path) {
        value = path?.let { p -> withContext(Dispatchers.IO) { decodeScaled(p, 720) } }
    }
    val image = bitmap
    if (image != null) {
        Image(
            image.asImageBitmap(),
            contentDescription = stringResource(R.string.chat_photo),
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(width = 240.dp, height = 180.dp).clip(RoundedCornerShape(12.dp)),
        )
    } else {
        Row(
            Modifier.size(width = 240.dp, height = 120.dp).clip(RoundedCornerShape(12.dp)).background(Fresh.surface3),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            GlyphIcon(Glyph.Camera, Fresh.inkFaint, size = 22.dp)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.chat_photo_coming), style = MaterialTheme.typography.bodyMedium, color = Fresh.inkMuted)
        }
    }
}

/** A photo small enough to show: decoded at about [maxSide] pixels on its longer side. */
private fun decodeScaled(path: String, maxSide: Int): Bitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
}.getOrNull()

@Composable
private fun Composer(
    text: String,
    onText: (String) -> Unit,
    tripNumber: String?,
    photo: String?,
    onCamera: () -> Unit,
    onRemovePhoto: () -> Unit,
    onSend: () -> Unit,
) {
    val canSend = ChatLogic.canSend(text, photo != null)
    Surface(color = Fresh.surface, shadowElevation = 12.dp) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (tripNumber != null) {
                Text(stringResource(R.string.chat_about_trip, tripNumber), style = MaterialTheme.typography.labelMedium, color = Fresh.info)
            }
            if (photo != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    GlyphIcon(Glyph.Camera, Fresh.primary, size = 18.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.chat_photo_added), style = MaterialTheme.typography.bodyMedium, color = Fresh.ink, modifier = Modifier.weight(1f))
                    Text(
                        stringResource(R.string.chat_remove_photo),
                        style = MaterialTheme.typography.labelLarge,
                        color = Fresh.critical,
                        modifier = Modifier.clickable(role = Role.Button, onClick = onRemovePhoto).padding(6.dp),
                    )
                }
            }
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ComposerButton(Glyph.Camera, stringResource(R.string.chat_take_photo), filled = false, enabled = true, onClick = onCamera)
                OutlinedTextField(
                    value = text,
                    onValueChange = onText,
                    placeholder = { Text(stringResource(R.string.chat_hint), color = Fresh.inkFaint) },
                    maxLines = 4,
                    shape = RoundedCornerShape(22.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Fresh.primary,
                        unfocusedBorderColor = Fresh.borderStrong,
                        unfocusedContainerColor = Fresh.surface,
                        focusedContainerColor = Fresh.surface,
                        cursorColor = Fresh.primary,
                    ),
                    modifier = Modifier.weight(1f),
                )
                ComposerButton(Glyph.Send, stringResource(R.string.chat_send), filled = true, enabled = canSend, onClick = onSend)
            }
        }
    }
}

@Composable
private fun ComposerButton(glyph: Glyph, description: String, filled: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .padding(bottom = 4.dp)
            .size(48.dp)
            .clip(CircleShape)
            .background(
                when {
                    !filled -> Fresh.surface3
                    enabled -> Fresh.primary
                    else -> Fresh.borderStrong
                },
            )
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        GlyphIcon(glyph, if (filled) Fresh.surface else Fresh.ink, size = 22.dp)
    }
}
