package com.morbeez.driver

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.morbeez.driver.data.mode.AppModeStore
import com.morbeez.driver.data.security.TokenStore
import com.morbeez.driver.data.sync.SyncWorker
import com.morbeez.driver.ui.nav.MorbeezNavGraph
import com.morbeez.driver.ui.owner.OwnerActivity
import com.morbeez.driver.ui.theme.Fresh
import com.morbeez.driver.ui.theme.MorbeezTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

// One install, two apps: the launcher, the driver's own screens — scoped to
// the driver's actual job: today's route, delivery confirmation,
// cash/payment collection, shortage/spoilage reporting, never a shrunk
// version of the web admin (System Architecture, MOB.4) — and owner mode,
// which is the owner web app itself (OwnerActivity).
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var tokenStore: TokenStore
    @Inject lateinit var modeStore: AppModeStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MorbeezTheme(darkBars = true) {
                Surface(modifier = Modifier, color = Fresh.bg) {
                    MorbeezNavGraph(
                        tokenStore = tokenStore,
                        modeStore = modeStore,
                        onOpenOwner = { startActivity(Intent(this, OwnerActivity::class.java)) },
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // App-foregrounded is one of the two sync triggers alongside the
        // periodic background pass (Driver App Architecture, DRV.5) — a
        // driver reopening the app after a signal dead zone shouldn't have
        // to wait for the next scheduled tick. Only a driver has anything to sync.
        if (tokenStore.isLoggedIn()) SyncWorker.requestNow(this)
    }
}
