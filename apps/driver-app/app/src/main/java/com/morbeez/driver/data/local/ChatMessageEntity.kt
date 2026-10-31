package com.morbeez.driver.data.local

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * A message in the driver's conversation with the office (D9): as the server
 * last listed it, and those written on this phone not sent yet. A message may
 * be about one of the driver's trips and may carry a photo — the driver's own
 * kept here as taken, the office's saved here once downloaded, so the
 * conversation reads with no signal.
 */
@Entity(tableName = "chat_messages")
data class ChatMessageEntity(
    @PrimaryKey val id: String,
    /** driver | office */
    val side: String,
    val senderName: String,
    val body: String? = null,
    val tripId: String? = null,
    val tripNumber: String? = null,
    /** none | pending (the photo not on the server yet) | ready */
    val photo: String = "none",
    /** The photo on this phone: taken here, or downloaded. */
    val localPhotoPath: String? = null,
    /** ISO instant: when it was written. */
    val writtenAt: String,
    /** ISO instant: when the server had it — what's unread is counted from this; null until sent. */
    val createdAt: String? = null,
    /** Written on this phone, not sent yet. */
    val pendingSync: Boolean = false,
)

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_messages ORDER BY writtenAt, COALESCE(createdAt, '~'), id")
    fun observeAll(): Flow<List<ChatMessageEntity>>

    @Query("SELECT * FROM chat_messages")
    suspend fun all(): List<ChatMessageEntity>

    @Query("SELECT * FROM chat_messages WHERE id = :id")
    suspend fun find(id: String): ChatMessageEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(message: ChatMessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(messages: List<ChatMessageEntity>)

    /** The server's list replaces what it last said; what this phone hasn't sent stays. */
    @Query("DELETE FROM chat_messages WHERE pendingSync = 0")
    suspend fun clearSynced()

    /** A message the office refused, removed from the phone by the driver (D8). */
    @Query("DELETE FROM chat_messages WHERE id = :id")
    suspend fun delete(id: String)
}
