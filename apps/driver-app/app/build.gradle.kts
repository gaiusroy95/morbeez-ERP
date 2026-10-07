plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
    id("com.google.dagger.hilt.android")
}

fun setting(name: String, default: String): String = (findProperty(name) as String?) ?: default

android {
    namespace = "com.morbeez.driver"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.morbeez.driver"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // Where the app finds the API (driver mode) and the owner web app (owner
    // mode). Override either per build: ./gradlew assembleDebug
    // -Pmorbeez.apiUrl=http://192.168.1.20:3000/ -Pmorbeez.ownerUrl=http://192.168.1.20:3001/
    buildTypes {
        debug {
            // 10.0.2.2 is the host machine, as the Android emulator sees it.
            buildConfigField("String", "API_BASE_URL", "\"${setting("morbeez.apiUrl", "http://10.0.2.2:3000/")}\"")
            buildConfigField("String", "OWNER_WEB_URL", "\"${setting("morbeez.ownerUrl", "http://10.0.2.2:3001/")}\"")
        }
        release {
            isMinifyEnabled = false
            // The hosts the production stack serves (infrastructure/terraform/modules/compute).
            buildConfigField("String", "API_BASE_URL", "\"${setting("morbeez.apiUrl", "https://api.morbeez.in/")}\"")
            buildConfigField("String", "OWNER_WEB_URL", "\"${setting("morbeez.ownerUrl", "https://app.morbeez.in/")}\"")
        }
        // A release build for sharing with the client before the Play Store:
        // signed with the debug key so the .apk installs directly, and pointed
        // at a hosted preview stack (infrastructure/runbooks/render-preview.md).
        // Both addresses are required — a preview must never fall back to the
        // production hosts above.
        //   ./gradlew assemblePreview -Pmorbeez.apiUrl=https://<api>.onrender.com/ -Pmorbeez.ownerUrl=https://<web>.onrender.com/
        create("preview") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            // Retrofit needs the trailing slash; add it rather than fail on it.
            val slash = { url: String? -> url?.trim()?.let { if (it.endsWith("/")) it else "$it/" } }
            val api = slash(findProperty("morbeez.apiUrl") as String?)
            val owner = slash(findProperty("morbeez.ownerUrl") as String?)
            val wantsPreview = gradle.startParameter.taskNames.any { it.contains("Preview", ignoreCase = true) }
            if (wantsPreview && (api == null || owner == null)) {
                throw GradleException("A preview build needs -Pmorbeez.apiUrl=<url> and -Pmorbeez.ownerUrl=<url> (the hosted API and owner app).")
            }
            buildConfigField("String", "API_BASE_URL", "\"${api ?: ""}\"")
            buildConfigField("String", "OWNER_WEB_URL", "\"${owner ?: ""}\"")
        }
    }
}

dependencies {
    // Compose
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.0")
    // Lifecycle 2.7, not 2.8: 2.8's collectAsStateWithLifecycle reads a
    // LocalLifecycleOwner that only Compose 1.7 provides, and this BOM is
    // Compose 1.6 — every screen crashed on first composition. Move both together.
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Room — on-device source of truth while offline (System Architecture MOB.2)
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    // SQLCipher — encrypts the Room database file at rest (Driver App Architecture DRV.10)
    implementation("net.zetetic:android-database-sqlcipher:4.5.4")
    implementation("androidx.sqlite:sqlite:2.4.0")

    // WorkManager — the sync engine's execution model (Driver App Architecture DRV.5)
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    // Reads a photo's rotation before it is shrunk for upload (PhotoShrinker).
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.hilt:hilt-work:1.2.0")
    ksp("androidx.hilt:hilt-compiler:1.2.0")

    // Hilt — dependency injection
    implementation("com.google.dagger:hilt-android:2.51.1")
    ksp("com.google.dagger:hilt-android-compiler:2.51.1")

    // Retrofit + Moshi — the typed HTTP client against the backend's OpenAPI contract
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Jetpack Security — Keystore-backed EncryptedSharedPreferences for the
    // token store and the SQLCipher passphrase (Driver App Architecture DRV.10-11)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
}
