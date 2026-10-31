package com.morbeez.driver.data.sync

import java.io.IOException

/** What a failed send means for the action (D8, field hardening). */
enum class SendFailure {
    /** The office refused it (4xx): it needs the driver, never a retry-and-hope (DRV.8). */
    REFUSED,

    /** The business's trial ended (402): nothing wrong with the action — kept as it is. */
    READ_ONLY,

    /** No signal, a timeout, the server busy or down: kept waiting, sent on a later pass. */
    TRANSIENT,
}

/** An action waiting for its own photos to go first — not refused, just not yet. */
class WaitingForPhotos(message: String) : Exception(message)

object Refusal {
    /**
     * Only the office's own "no" makes an action need attention. A dropped
     * connection on a moving vehicle is not a refusal — it used to be marked
     * so, and the phone (and the owner's Driver phones screen) showed it stuck.
     * 401 is the session, not the action (the authenticator signs the driver
     * in again); 408 and 429 ask to come back later.
     */
    fun classify(error: Throwable?): SendFailure = when {
        error is retrofit2.HttpException -> when (val code = error.code()) {
            402 -> SendFailure.READ_ONLY
            401, 408, 429 -> SendFailure.TRANSIENT
            in 400..499 -> SendFailure.REFUSED
            else -> SendFailure.TRANSIENT
        }
        error is IOException || error is WaitingForPhotos -> SendFailure.TRANSIENT
        // A payload this phone can't read back is a refusal of a kind: trying again won't change it.
        error is IllegalStateException || error is com.squareup.moshi.JsonDataException -> SendFailure.REFUSED
        else -> SendFailure.TRANSIENT
    }
}
