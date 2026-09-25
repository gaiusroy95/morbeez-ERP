plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.morbeez.driver"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.morbeez.driver"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.0.0"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    // Jetpack Compose, Room, WorkManager, Hilt — added when implementation
    // starts (Technology Stack, Section 02).
}
