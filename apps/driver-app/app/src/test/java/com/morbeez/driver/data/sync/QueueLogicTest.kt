package com.morbeez.driver.data.sync

import com.morbeez.driver.data.local.PendingOperationEntity
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.io.IOException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class QueueLogicTest {
    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()

    private fun op(type: PendingOperationType, payload: String, sequence: Long, error: String? = "refused") = PendingOperationEntity(
        idempotencyKey = "k$sequence", tripId = "t1", operationType = type.name, payloadJson = payload,
        createdAt = sequence, sequence = sequence, status = if (error != null) "failed_needs_review" else "pending", lastError = error,
    )

    private fun http(code: Int) = HttpException(Response.error<Any>(code, "{}".toResponseBody(null)))

    @Test
    fun `only the office's no needs the driver - a dropped signal or a busy server keeps it waiting`() {
        assertEquals(SendFailure.REFUSED, Refusal.classify(http(409)))
        assertEquals(SendFailure.REFUSED, Refusal.classify(http(400)))
        assertEquals(SendFailure.READ_ONLY, Refusal.classify(http(402)))
        assertEquals(SendFailure.TRANSIENT, Refusal.classify(http(401)))
        assertEquals(SendFailure.TRANSIENT, Refusal.classify(http(429)))
        assertEquals(SendFailure.TRANSIENT, Refusal.classify(http(503)))
        assertEquals(SendFailure.TRANSIENT, Refusal.classify(IOException("timeout")))
        assertEquals(SendFailure.TRANSIENT, Refusal.classify(WaitingForPhotos("The delivery's photos haven't uploaded yet")))
        assertEquals(SendFailure.REFUSED, Refusal.classify(IllegalStateException("A photo for it was refused")))
    }

    @Test
    fun `a refused stop is flagged with the first refusal's words`() {
        val failed = listOf(
            op(PendingOperationType.COMPLETE_DELIVERY_STOP, """{"stopId":"s2","recipientName":"Manager"}""", 3, "This stop was already completed"),
            op(PendingOperationType.RECORD_COLLECTION, """{"stopId":"s2","amount":600.0,"method":"cash"}""", 4, "Not delivered yet"),
            op(PendingOperationType.RECORD_EXPENSE, """{"category":"toll","amount":80.0}""", 5),
            op(PendingOperationType.ARRIVE_STOP, """{"stopId":"s3"}""", 6, null),
        )
        assertEquals(mapOf("s2" to "This stop was already completed"), QueueLogic.refusedStops(failed, moshi))
    }

    @Test
    fun `the money and readings in an action`() {
        assertEquals(600.0, QueueLogic.amountOf(op(PendingOperationType.RECORD_COLLECTION, """{"stopId":"s2","amount":600.0,"method":"cash"}""", 1), moshi)!!, 0.0)
        assertEquals("cash", QueueLogic.detailOf(op(PendingOperationType.RECORD_COLLECTION, """{"stopId":"s2","amount":600.0,"method":"cash"}""", 1), moshi))
        assertEquals(4500.0, QueueLogic.amountOf(op(PendingOperationType.SUBMIT_TRIP, """{"cashDeclared":4500.0,"note":null}""", 2), moshi)!!, 0.0)
        assertEquals(48970.0, QueueLogic.kmOf(op(PendingOperationType.RETURN_TRIP, """{"closingKm":48970.0}""", 3), moshi)!!, 0.0)
        assertNull(QueueLogic.stopIdOf(op(PendingOperationType.RECORD_EXPENSE, """{"category":"toll","amount":80.0}""", 4), moshi))
        assertTrue(PendingOperationType.RECORD_DEPOSIT.name in QueueLogic.MONEY)
        assertTrue(PendingOperationType.RETURN_TRIP.name in QueueLogic.FIXABLE)
    }
}
