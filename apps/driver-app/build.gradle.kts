// Root Gradle build file. Structure only — plugin versions and dependency
// blocks (Compose, Room, WorkManager, Hilt) are added when implementation
// starts (Technology Stack, Section 02).
plugins {
    id("com.android.application") version "8.5.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
