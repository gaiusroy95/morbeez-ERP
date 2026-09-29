package com.morbeez.driver

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.morbeez.driver.data.security.TokenStore
import com.morbeez.driver.data.sync.SyncWorker
import com.morbeez.driver.ui.nav.MorbeezNavGraph
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

// Scoped to the driver's actual job: today's route, delivery confirmation,
// cash/payment collection, shortage/spoilage reporting — never a shrunk
// version of the web admin (System Architecture, MOB.4).
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var tokenStore: TokenStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier) {
                    MorbeezNavGraph(tokenStore = tokenStore)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // App-foregrounded is one of the two sync triggers alongside the
        // periodic background pass (Driver App Architecture, DRV.5) — a
        // driver reopening the app after a signal dead zone shouldn't have
        // to wait for the next scheduled tick.
        SyncWorker.requestNow(this)
    }
}
