package com.morbeez.driver.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Mirrors the slice of fulfilment.trip a driver's own device needs — not
 * the whole backend row. The device holds at most one active trip's full
 * detail at a time (Driver App Architecture, DRV.3).
 */
@Entity(tableName = "trips")
data class TripEntity(
    @PrimaryKey val id: String,
    val vehicleId: String,
    val vehicleRegistrationNumber: String,
    val driverEmployeeId: String,
    // planned | in_progress | completed (submitted, awaiting the owner) | on_hold | cancelled | reconciled
    val status: String,
    val plannedDate: String?,
    val advanceAmount: String,
    val version: Int,
    /** The owner's note when they returned the trip to the driver, or put it on hold. */
    val reviewNote: String? = null,
    /** The cash the driver said they're handing over, once submitted. */
    val cashDeclared: String? = null,
    /** Delegation level on this trip (1–4); 0 = waiting for the owner's approval; null = not known yet. */
    val authorityLevel: Int? = null,
    /** "T-20261028-001". */
    val number: String? = null,
    /** Start Day: the odometer when the trip set off, and when. */
    val openingKm: String? = null,
    val startedAt: String? = null,
    /** Start Trip (D3): when the delivery run set off. */
    val deliveryStartedAt: String? = null,
    /** Return (D4): the odometer when back, and when. */
    val closingKm: String? = null,
    val returnedAt: String? = null,
)
