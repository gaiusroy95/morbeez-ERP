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
    /** Who's there and where: to call them, and to navigate to their map pin (or address). */
    val partyPhone: String? = null,
    val partyPlace: String? = null,
    val partyAddress: String? = null,
    val partyLatitude: Double? = null,
    val partyLongitude: Double? = null,
    /** When the driver reached it (D2: Start pickup). */
    val arrivedAt: String? = null,
    /** A completed farm stop, as JSON (FarmStopOutcomeResponse): from the server, or from this phone until it hears. */
    val farmJson: String? = null,
    /** A shop's QR token: the QR at the door must match it (D3). */
    val partyQrToken: String? = null,
    /** A completed delivery, as JSON (DeliveryOutcomeResponse): from the server, or from this phone until it hears. */
    val deliveryJson: String? = null,
)
