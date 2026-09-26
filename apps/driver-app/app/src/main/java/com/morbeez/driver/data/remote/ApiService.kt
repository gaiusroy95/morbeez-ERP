package com.morbeez.driver.data.remote

import com.morbeez.driver.data.remote.dto.*
import okhttp3.MultipartBody
import retrofit2.http.*

/**
 * Typed HTTP client against the backend's OpenAPI contract, with
 * device-bound auth tokens (Constitution V.7). Every call here replays
 * against the exact same handler the web app uses (Driver App
 * Architecture, DRV.6) — there is no separate mobile API.
 */
interface ApiService {

    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): TokenPairResponse

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): TokenPairResponse

    @POST("auth/logout")
    suspend fun logout(@Body body: RefreshRequest)

    // ---- Trips (driver-scoped — Driver App Architecture, DRV.14) ----

    @GET("logistics/trips/mine")
    suspend fun listMyTrips(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 25,
    ): PagedResponse<TripResponse>

    @GET("logistics/trips/{tripId}/stops")
    suspend fun listStops(@Path("tripId") tripId: String): List<TripStopResponse>

    @POST("logistics/trips/{tripId}/start")
    suspend fun startTrip(@Path("tripId") tripId: String, @Body body: VersionRequest): TripResponse

    @POST("logistics/trips/{tripId}/complete")
    suspend fun completeTrip(@Path("tripId") tripId: String, @Body body: VersionRequest): TripResponse

    @POST("logistics/trips/{tripId}/stops/{stopId}/complete-pickup")
    suspend fun completePickupStop(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
    ): TripStopResponse

    @POST("logistics/trips/{tripId}/stops/{stopId}/complete-delivery")
    suspend fun completeDeliveryStop(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
        @Body body: CompleteDeliveryRequest,
    ): TripStopResponse

    @POST("logistics/trips/{tripId}/stops/{stopId}/skip")
    suspend fun skipStop(@Path("tripId") tripId: String, @Path("stopId") stopId: String): TripStopResponse

    // ---- Photos ----

    @Multipart
    @POST("logistics/trips/{tripId}/stops/{stopId}/photos")
    suspend fun uploadPhoto(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
        @Part("photoType") photoType: okhttp3.RequestBody,
        @Part file: MultipartBody.Part,
    ): TripStopPhotoResponse

    @GET("logistics/trips/{tripId}/stops/{stopId}/photos")
    suspend fun listPhotos(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
    ): List<TripStopPhotoResponse>

    // ---- Expenses ----

    @GET("logistics/trips/{tripId}/expenses")
    suspend fun listExpenses(@Path("tripId") tripId: String): List<TripExpenseResponse>

    @POST("logistics/trips/{tripId}/expenses")
    suspend fun recordExpense(@Path("tripId") tripId: String, @Body body: RecordExpenseRequest): TripExpenseResponse

    // ---- Collections ----

    @GET("logistics/trips/{tripId}/stops/{stopId}/collections")
    suspend fun listCollections(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
    ): List<CustomerCollectionResponse>

    @POST("logistics/trips/{tripId}/stops/{stopId}/collections")
    suspend fun recordCollection(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
        @Body body: RecordCollectionRequest,
    ): CustomerCollectionResponse

    // ---- Cross-module reads used only to render Stop Detail ----

    @GET("procurement/pickups/{id}")
    suspend fun getPickup(@Path("id") id: String): PickupResponse

    @GET("orders/{id}")
    suspend fun getOrder(@Path("id") id: String): OrderResponse

    @GET("farmers/{id}")
    suspend fun getFarmer(@Path("id") id: String): FarmerResponse

    @GET("customers/{id}")
    suspend fun getCustomer(@Path("id") id: String): CustomerResponse
}
