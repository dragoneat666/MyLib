plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing comes from environment variables (set by GitHub Actions from
// repository secrets, or locally). Without them the release APK is signed with
// the debug key so it still installs.
val keystoreFile = System.getenv("MYLIB_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }

android {
    namespace = "club.denflix.mylib"
    compileSdk = 34

    defaultConfig {
        applicationId = "club.denflix.mylib"
        minSdk = 26
        targetSdk = 34
        versionCode = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "1.0.0"
        // Phones are ARM. Limiting CPU types keeps the APK small, since the
        // barcode/text models are bundled once per CPU type.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = keystoreFile
                storePassword = System.getenv("MYLIB_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MYLIB_KEY_ALIAS") ?: "mylib"
                keyPassword = System.getenv("MYLIB_KEY_PASSWORD") ?: System.getenv("MYLIB_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            ndk { abiFilters += "x86_64" } // for the emulator
        }
        release {
            isMinifyEnabled = false
            signingConfig = if (keystoreFile != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Camera + on-device barcode and text recognition (models bundled, works offline)
    val camerax = "1.3.4"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-view:$camerax")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("com.google.mlkit:text-recognition:16.0.1")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
