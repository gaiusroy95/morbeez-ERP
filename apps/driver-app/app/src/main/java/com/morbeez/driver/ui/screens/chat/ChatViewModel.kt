package com.morbeez.driver.ui.screens.chat

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.device.NetworkMonitor
import com.morbeez.driver.data.local.ChatMessageEntity
import com.morbeez.driver.data.local.TripEntity
import com.morbeez.driver.data.repository.ChatRepository
import com.morbeez.driver.data.repository.TripRepository
import com.morbeez.driver.data.sync.SyncWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** The conversation as it is on the phone, and the trip a message may be about. */
data class ChatUiState(
    val messages: List<ChatMessageEntity> = emptyList(),
    val trip: TripEntity? = null,
    val online: Boolean = true,
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val chat: ChatRepository,
    trips: TripRepository,
    network: NetworkMonitor,
) : ViewModel() {
    val state: StateFlow<ChatUiState> = combine(chat.observeMessages(), trips.observeActiveTrip(), network.online) { messages, trip, online ->
        ChatUiState(messages, trip, online)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ChatUiState())

    /** While the conversation is open: the office's replies, without a whole sync. */
    suspend fun pull() {
        if (state.value.online) runCatching { chat.refresh() }
    }

    /** Written, perhaps about the trip, perhaps with a photo: on the phone at once, sent when there's signal. */
    fun send(body: String, aboutTrip: Boolean, photoPath: String?) {
        val trip = state.value.trip?.takeIf { aboutTrip }
        viewModelScope.launch {
            chat.send(body, trip?.let { it.id to it.number }, photoPath)
            SyncWorker.requestNow(appContext)
        }
    }

    /** Opened: what's there is read. */
    fun markRead() {
        viewModelScope.launch { chat.markRead() }
    }
}
