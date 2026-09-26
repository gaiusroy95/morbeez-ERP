package com.morbeez.driver.data.remote.dto

// Field names match the backend's JSON responses exactly (its entity
// records already serialize as camelCase) — no @Json remapping needed.

data class LoginRequest(val email: String, val password: String)
data class RefreshRequest(val refreshToken: String)

data class PublicUserResponse(val id: String, val email: String, val status: String)
data class TokenPairResponse(
    val accessToken: String,
    val refreshToken: String,
    val user: PublicUserResponse,
)

data class PagedResponse<T>(val items: List<T>, val total: Int, val page: Int, val pageSize: Int)

data class TripResponse(
    val id: String,
    val vehicleId: String,
    val driverEmployeeId: String,
    val status: String,
    val plannedDate: String?,
    val advanceAmount: String,
    val startedAt: String?,
    val completedAt: String?,
    val version: Int,
)

data class TripStopResponse(
    val id: String,
    val tripId: String,
    val sequenceNumber: Int,
    val stopType: String,
    val pickupId: String?,
    val orderId: String?,
    val status: String,
    val arrivedAt: String?,
    val completedAt: String?,
    val notes: String?,
)

data class PickupResponse(
    val id: String,
    val purchaseOrderId: String,
    val farmerId: String,
    val status: String,
    val version: Int,
)

data class OrderLineResponse(val id: String, val productId: String, val quantity: String, val unitPrice: String)
data class OrderResponse(
    val id: String,
    val customerId: String,
    val status: String,
    val version: Int,
    val lines: List<OrderLineResponse>?,
)

data class FarmerResponse(val id: String, val name: String)
data class CustomerResponse(val id: String, val name: String)

data class VersionRequest(val version: Int)

data class CompleteDeliveryRequest(val recipientName: String, val signatureData: String?)

data class RecordExpenseRequest(val category: String, val amount: Double, val notes: String?)
data class TripExpenseResponse(
    val id: String,
    val tripId: String,
    val category: String,
    val amount: String,
    val notes: String?,
    val recordedBy: String,
    val recordedAt: String,
)

data class RecordCollectionRequest(val amount: Double, val method: String, val notes: String?)
data class CustomerCollectionResponse(
    val id: String,
    val tripStopId: String,
    val orderId: String,
    val amount: String,
    val method: String,
    val notes: String?,
    val collectedBy: String,
    val collectedAt: String,
)

data class TripStopPhotoResponse(
    val id: String,
    val tripStopId: String,
    val photoType: String,
    val storageKey: String,
    val contentType: String,
    val sizeBytes: Int,
    val takenAt: String,
)
