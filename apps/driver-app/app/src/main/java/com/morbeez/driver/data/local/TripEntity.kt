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
    val status: String, // planned | in_progress | completed | cancelled | reconciled
    val plannedDate: String?,
    val advanceAmount: String,
    val version: Int,
)
