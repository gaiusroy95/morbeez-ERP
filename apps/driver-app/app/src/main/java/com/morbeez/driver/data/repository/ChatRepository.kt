package com.morbeez.driver.data.repository

import android.content.Context
import com.morbeez.driver.data.local.ChatDao
import com.morbeez.driver.data.local.ChatMessageEntity
import com.morbeez.driver.data.local.DriverDayDao
import com.morbeez.driver.data.local.PendingOperationDao
import com.morbeez.driver.data.local.PendingOperationEntity
import com.morbeez.driver.data.local.PendingPhotoDao
import com.morbeez.driver.data.local.PendingPhotoEntity
import com.morbeez.driver.data.remote.ApiService
import com.morbeez.driver.data.remote.dto.ChatMessageResponse
import com.morbeez.driver.data.sync.PendingOperationType
import com.morbeez.driver.data.sync.PhotoShrinker
import com.morbeez.driver.data.sync.ReadChatPayload
import com.morbeez.driver.data.sync.SendMessagePayload
import com.morbeez.driver.ui.screens.chat.ChatLogic
import com.squareup.moshi.Moshi
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The conversation with the office (D9). Like [TripRepository], screens only
 * read and write Room here: a message is on the phone at once and sent when
 * there's signal, its photo after it; the office's messages come down with
 * every sync and their photos are kept here, so it all reads offline.
 */
@Singleton
class ChatRepository @Inject constructor(
    private val api: ApiService,
    private val chatDao: ChatDao,
    private val dayDao: DriverDayDao,
    private val pendingOperationDao: PendingOperationDao,
    private val pendingPhotoDao: PendingPhotoDao,
    private val moshi: Moshi,
    @ApplicationContext private val appContext: Context,
) {
    fun observeMessages(): Flow<List<ChatMessageEntity>> = chatDao.observeAll()

    /** What the office wrote that the driver hasn't read: the drawer's badge. */
    fun observeUnread(): Flow<Int> = combine(chatDao.observeAll(), dayDao.observe()) { messages, day -> ChatLogic.unreadOf(messages, day?.chatReadAt) }

    /**
     * A message to the office: on the phone at once, sent when there's
     * signal — perhaps about a trip, perhaps with a photo, which follows it.
     */
    suspend fun send(body: String, trip: Pair<String, String?>?, photoPath: String?) {
        val id = UUID.randomUUID().toString()
        val text = body.trim().take(ChatLogic.MAX_LENGTH).ifBlank { null }
        val kept = photoPath?.let { keepPhoto(id, it) }
        val writtenAt = Instant.now().toString()
        chatDao.upsert(
            ChatMessageEntity(
                id = id,
                side = "driver",
                senderName = dayDao.find()?.driverName.orEmpty(),
                body = text,
                tripId = trip?.first,
                tripNumber = trip?.second,
                photo = if (kept != null) "pending" else "none",
                localPhotoPath = kept,
                writtenAt = writtenAt,
                pendingSync = true,
            ),
        )
        enqueue(trip?.first.orEmpty(), PendingOperationType.SEND_MESSAGE, SendMessagePayload(id, text, trip?.first, kept != null, writtenAt))
        if (kept != null) {
            pendingPhotoDao.insert(
                PendingPhotoEntity(
                    id = UUID.randomUUID().toString(),
                    tripId = trip?.first.orEmpty(),
                    stopId = id,
                    photoType = "chat",
                    localPath = kept,
                    mimeType = "image/jpeg",
                    createdAt = System.currentTimeMillis(),
                    target = "chat",
                ),
            )
        }
    }

    /** The camera's file, moved where the conversation keeps its photos (the cache may be cleared). */
    private suspend fun keepPhoto(messageId: String, path: String): String {
        PhotoShrinker.shrink(path)
        val target = File(photoDir(appContext).apply { mkdirs() }, "$messageId.jpg")
        val source = File(path)
        if (!source.renameTo(target)) {
            source.copyTo(target, overwrite = true)
            source.delete()
        }
        return target.absolutePath
    }

    /** Opened: read up to the latest message the server had — on the phone at once, the server told when there's signal. */
    suspend fun markRead() {
        val latest = ChatLogic.latestOf(chatDao.all()) ?: return
        val day = dayDao.find() ?: return
        if (day.chatReadAt != null && ChatLogic.laterOf(day.chatReadAt, latest) == day.chatReadAt) return
        dayDao.upsert(day.copy(chatReadAt = latest))
        pendingOperationDao.deletePending(PendingOperationType.READ_CHAT.name)
        enqueue("", PendingOperationType.READ_CHAT, ReadChatPayload(latest))
    }

    /** The server has the message (or its photo): as it says. */
    suspend fun markSent(sent: ChatMessageResponse) {
        val local = chatDao.find(sent.id)
        chatDao.upsert(toEntity(sent, local?.localPhotoPath))
    }

    /** Its photo waits until the message itself is on the server. */
    suspend fun isUnsent(messageId: String): Boolean = chatDao.find(messageId)?.pendingSync == true

    /**
     * The conversation as the server has it, replacing what it last said
     * (what this phone hasn't sent stays); the office's latest photos are
     * saved here, and how far the driver has read never goes back.
     */
    suspend fun refresh() = pulls.withLock {
        val thread = api.getMyChat()
        val before = chatDao.all().associateBy { it.id }
        chatDao.clearSynced()
        chatDao.upsertAll(thread.messages.map { toEntity(it, before[it.id]?.localPhotoPath) })
        dayDao.find()?.let { day -> dayDao.upsert(day.copy(chatReadAt = ChatLogic.laterOf(day.chatReadAt, thread.readAt))) }

        val dir = photoDir(appContext).apply { mkdirs() }
        val missing = chatDao.all().filter { it.photo == "ready" && (it.localPhotoPath == null || !File(it.localPhotoPath).exists()) }
        for (m in missing.sortedByDescending { it.writtenAt }.take(PHOTOS_KEPT)) {
            val file = File(dir, "${m.id}.jpg")
            val saved = runCatching {
                api.getChatPhoto(m.id).use { body -> file.outputStream().use { out -> body.byteStream().copyTo(out) } }
            }.isSuccess
            if (saved) chatDao.upsert(m.copy(localPhotoPath = file.absolutePath)) else file.delete()
        }
        // Photos of messages the server no longer lists — not one just taken, its message being written.
        val kept = chatDao.all().mapNotNull { it.localPhotoPath }.toSet()
        val settled = System.currentTimeMillis() - 60_000
        dir.listFiles()?.filter { it.absolutePath !in kept && it.lastModified() < settled }?.forEach { it.delete() }
    }

    private fun toEntity(m: ChatMessageResponse, localPhotoPath: String?) = ChatMessageEntity(
        id = m.id,
        side = m.side,
        senderName = m.senderName,
        body = m.body,
        tripId = m.tripId,
        tripNumber = m.tripNumber,
        photo = m.photo,
        localPhotoPath = localPhotoPath?.takeIf { File(it).exists() },
        writtenAt = m.writtenAt,
        createdAt = m.createdAt,
    )

    private suspend inline fun <reified T> enqueue(tripId: String, type: PendingOperationType, payload: T) {
        pendingOperationDao.insert(
            PendingOperationEntity(
                idempotencyKey = UUID.randomUUID().toString(),
                tripId = tripId,
                operationType = type.name,
                payloadJson = moshi.adapter(T::class.java).toJson(payload),
                createdAt = System.currentTimeMillis(),
                sequence = pendingOperationDao.maxSequence() + 1,
            ),
        )
    }

    /** One pull at a time: a sync pass's and the open conversation's never interleave. */
    private val pulls = Mutex()

    companion object {
        /** The office's photos kept on the phone, latest first. */
        private const val PHOTOS_KEPT = 30

        fun photoDir(context: Context) = File(context.filesDir, "chat")
    }
}
