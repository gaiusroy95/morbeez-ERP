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

    @POST("auth/pin-login")
    suspend fun pinLogin(@Body body: PinLoginRequest): TokenPairResponse

    @POST("auth/pin")
    suspend fun setPin(@Body body: SetPinRequest): SetPinResponse

    @GET("users/me/preferences")
    suspend fun getPreferences(): PreferencesBody

    @PATCH("users/me/preferences")
    suspend fun setPreferences(@Body body: PreferencesBody): PreferencesBody

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

    /** Today's trip (the owner plans first), its vehicle and the vehicle's last odometer reading, this week's earnings, vehicle stock. */
    @GET("logistics/trips/mine/day")
    suspend fun getMyDay(): DriverDayResponse

    @GET("logistics/trips/{tripId}/stops")
    suspend fun listStops(@Path("tripId") tripId: String): List<TripStopResponse>

    /** Start Day: sets off, with the opening KM and the phone's position. */
    @POST("logistics/trips/{tripId}/start")
    suspend fun startTrip(@Path("tripId") tripId: String, @Body body: StartTripRequest): TripResponse

    /** The driver submits the trip: completed, awaiting the owner's reconciliation. */
    @POST("logistics/trips/{tripId}/complete")
    suspend fun completeTrip(@Path("tripId") tripId: String, @Body body: SubmitTripRequest): TripResponse

    @POST("logistics/trips/{tripId}/deposits")
    suspend fun recordDeposit(
        @Path("tripId") tripId: String,
        @Body body: RecordDepositRequest,
        @Header("Idempotency-Key") idempotencyKey: String,
    ): TripCashDepositResponse

    @GET("logistics/trips/{tripId}")
    suspend fun getTrip(@Path("tripId") tripId: String): TripResponse

    @GET("logistics/trips/{tripId}/handover")
    suspend fun getHandover(@Path("tripId") tripId: String): HandoverResponse

    @POST("logistics/trips/{tripId}/stops/{stopId}/complete-pickup")
    suspend fun completePickupStop(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
        @Body body: CompletePickupRequest,
    ): TripStopResponse

    @POST("logistics/trips/{tripId}/stops/{stopId}/complete-delivery")
    suspend fun completeDeliveryStop(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
        @Body body: CompleteDeliveryRequest,
    ): TripStopResponse

    @POST("logistics/trips/{tripId}/stops/{stopId}/skip")
    suspend fun skipStop(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
        @Body body: SkipStopRequest,
    ): TripStopResponse

    @GET("logistics/trips/{tripId}/authority")
    suspend fun getAuthority(@Path("tripId") tripId: String): AuthorityResponse

    @POST("logistics/trips/{tripId}/problem")
    suspend fun reportProblem(
        @Path("tripId") tripId: String,
        @Body body: ReportProblemRequest,
        @Header("Idempotency-Key") idempotencyKey: String,
    ): ReportProblemResponse

    // ---- Photos ----

    @Multipart
    @POST("logistics/trips/{tripId}/stops/{stopId}/photos")
    suspend fun uploadPhoto(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
        @Part("photoType") photoType: okhttp3.RequestBody,
        @Part file: MultipartBody.Part,
        /** A farm stop's rejection photo names its product; left out otherwise. */
        @Part("productId") productId: okhttp3.RequestBody? = null,
    ): TripStopPhotoResponse

    /** Return (D4): the closing KM when the vehicle is back. */
    @POST("logistics/trips/{tripId}/closing-km")
    suspend fun returnTrip(@Path("tripId") tripId: String, @Body body: ReturnTripRequest): TripResponse

    /** Collections (D4): the customers delivered on the trip, with what each owes in all. */
    @GET("logistics/trips/{tripId}/collections")
    suspend fun getTripCollections(@Path("tripId") tripId: String): TripCollectionsResponse

    /** A customer disputes part of what they owe (D4). */
    @POST("logistics/trips/{tripId}/stops/{stopId}/disputes")
    suspend fun raiseStopDispute(@Path("tripId") tripId: String, @Path("stopId") stopId: String, @Body body: RaiseDisputeRequest): InvoiceDisputeResponse

    /** Start Trip (D3): the delivery run sets off. */
    @POST("logistics/trips/{tripId}/start-deliveries")
    suspend fun startDeliveries(@Path("tripId") tripId: String): TripResponse

    // ---- Backhaul (D5) ----

    @GET("logistics/trips/{tripId}/backhauls")
    suspend fun listBackhauls(@Path("tripId") tripId: String): List<BackhaulResponse>

    /** One the driver took on the road; the same id again is the same backhaul. */
    @POST("logistics/trips/{tripId}/backhauls")
    suspend fun createBackhaul(@Path("tripId") tripId: String, @Body body: CreateBackhaulRequest): BackhaulResponse

    @POST("logistics/trips/{tripId}/backhauls/{backhaulId}/accept")
    suspend fun acceptBackhaul(@Path("tripId") tripId: String, @Path("backhaulId") backhaulId: String): BackhaulResponse

    @POST("logistics/trips/{tripId}/backhauls/{backhaulId}/skip")
    suspend fun skipBackhaul(@Path("tripId") tripId: String, @Path("backhaulId") backhaulId: String, @Body body: SkipBackhaulRequest): BackhaulResponse

    /** Pickup reached, loaded, drop reached, completed — in that order. */
    @POST("logistics/trips/{tripId}/backhauls/{backhaulId}/steps")
    suspend fun backhaulStep(@Path("tripId") tripId: String, @Path("backhaulId") backhaulId: String, @Body body: BackhaulStepRequest): BackhaulResponse

    @POST("logistics/trips/{tripId}/backhauls/{backhaulId}/payment")
    suspend fun payBackhaul(@Path("tripId") tripId: String, @Path("backhaulId") backhaulId: String, @Body body: BackhaulPaymentRequest): BackhaulResponse

    @Multipart
    @POST("logistics/trips/{tripId}/backhauls/{backhaulId}/photos")
    suspend fun uploadBackhaulPhoto(
        @Path("tripId") tripId: String,
        @Path("backhaulId") backhaulId: String,
        @Part("photoType") photoType: okhttp3.RequestBody,
        @Part file: MultipartBody.Part,
    ): BackhaulPhotoResponse

    /** The driver reached the stop (D2: Start pickup). */
    @POST("logistics/trips/{tripId}/stops/{stopId}/arrive")
    suspend fun arriveAtStop(@Path("tripId") tripId: String, @Path("stopId") stopId: String): TripStopResponse

    @GET("logistics/trips/{tripId}/stops/{stopId}/photos")
    suspend fun listPhotos(
        @Path("tripId") tripId: String,
        @Path("stopId") stopId: String,
    ): List<TripStopPhotoResponse>

    // ---- Expenses ----

    @GET("logistics/trips/{tripId}/expenses")
    suspend fun listExpenses(@Path("tripId") tripId: String): List<TripExpenseResponse>

    // The queued operation's key goes with every attempt, so a retry after a
    // lost response returns the first expense instead of recording a second
    // (Security Audit SA-03; Constitution I.7, IV.3).
    @POST("logistics/trips/{tripId}/expenses")
    suspend fun recordExpense(
        @Path("tripId") tripId: String,
        @Body body: RecordExpenseRequest,
        @Header("Idempotency-Key") idempotencyKey: String,
    ): TripExpenseResponse

    @Multipart
    @POST("logistics/trips/{tripId}/expenses/{expenseId}/photos")
    suspend fun uploadExpensePhoto(
        @Path("tripId") tripId: String,
        @Path("expenseId") expenseId: String,
        @Part("photoType") photoType: okhttp3.RequestBody,
        @Part file: MultipartBody.Part,
    ): ExpensePhotoResponse

    // ---- The driver's own records (D6) ----

    @GET("logistics/trips/mine/expenses")
    suspend fun getMyExpenses(@Query("from") from: String? = null, @Query("to") to: String? = null): MyExpensesResponse

    @GET("logistics/trips/mine/approvals")
    suspend fun getMyApprovals(): DriverApprovalsResponse

    @GET("logistics/trips/mine/history")
    suspend fun getMyHistory(@Query("from") from: String? = null, @Query("to") to: String? = null): TripHistoryResponse

    @GET("logistics/trips/mine/vehicle")
    suspend fun getMyVehicle(): MyVehicleResponse

    @GET("logistics/trips/mine/profile")
    suspend fun getMyProfile(): DriverProfileResponse

    @GET("logistics/trips/mine/earnings")
    suspend fun getMyEarnings(@Query("period") period: String): MyEarningsResponse

    @GET("logistics/trips/mine/settlements")
    suspend fun getMySettlements(): List<DriverSettlementResponse>

    /** "I received it": once paid; again changes nothing. */
    @POST("logistics/trips/mine/settlements/{settlementId}/received")
    suspend fun acknowledgeSettlement(@Path("settlementId") settlementId: String): DriverSettlementResponse

    @GET("logistics/trips/{tripId}/summary")
    suspend fun getTripSummary(@Path("tripId") tripId: String): DriverTripSummaryResponse

    // ---- The phone's sync, for the office (owner Phase 8) ----

    @POST("devices/sync-report")
    suspend fun reportSync(@Body body: SyncReportRequest)

    // ---- Chat with the office (D9) ----

    @GET("chat/mine")
    suspend fun getMyChat(): ChatThreadResponse

    /** Sent again with the same id, it's the same message. */
    @POST("chat/mine")
    suspend fun sendChatMessage(@Body body: SendChatMessageRequest): ChatMessageResponse

    @POST("chat/mine/read")
    suspend fun readChat(@Body body: ChatReadRequest): ChatReadResponse

    /** The photo a message said would follow — once it's on the server. */
    @Multipart
    @POST("chat/messages/{messageId}/photo")
    suspend fun uploadChatPhoto(@Path("messageId") messageId: String, @Part file: MultipartBody.Part): ChatMessageResponse

    @Streaming
    @GET("chat/messages/{messageId}/photo")
    suspend fun getChatPhoto(@Path("messageId") messageId: String): okhttp3.ResponseBody

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
        @Header("Idempotency-Key") idempotencyKey: String,
    ): CustomerCollectionResponse
}
