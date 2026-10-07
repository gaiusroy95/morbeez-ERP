package com.morbeez.driver.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * A read-write projection of fulfilment.trip_stop, denormalized with just
 * enough of the pickup/order it points at to render Stop Detail without a
 * second round trip while offline (Driver App Architecture, DRV.2).
 */
@Entity(tableName = "trip_stops")
data class TripStopEntity(
    @PrimaryKey val id: String,
    val tripId: String,
    val sequenceNumber: Int,
    val stopType: String, // pickup | delivery
    val status: String, // pending | completed | skipped
    val pickupId: String?,
    val orderId: String?,
    // Denormalized display fields — a farmer's name for a pickup stop, a
    // customer's name and order lines summary for a delivery stop.
    val counterpartyName: String,
    val summary: String,
    val notes: String?,
    // True once this row's completion/skip has been confirmed by the
    // backend; false means a PendingOperation for it is still queued or
    // failed (Driver App Architecture, DRV.4).
    val pendingSync: Boolean = false,
    /** For a delivery: "cash" (collect [collectAmount] at the door) or "credit". */
    val collectTerms: String? = null,
    val collectAmount: String? = null,
    /** The stop's lines as JSON (List<StopItemResponse>): what's weighed or counted at this stop. */
    val itemsJson: String? = null,
)
