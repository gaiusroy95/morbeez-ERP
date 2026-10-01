package com.morbeez.driver.ui.owner

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.morbeez.driver.BuildConfig
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.theme.Fresh
import com.morbeez.driver.ui.theme.MorbeezTheme

/**
 * Owner mode: the owner web app, full screen inside this app. The web app
 * is the one the owner would use in a browser (apps/owner-app); nothing of
 * it is rebuilt here. Its session lives in the web app's own httpOnly
 * cookies, in this app's private WebView storage — the page never sees a
 * token, and this app never sees the page's (the driver's Keystore-held
 * session, DRV.10, is untouched by this mode).
 *
 * Hardened as a single-site browser: only the owner app's own origin loads
 * here; every other link leaves for the phone's browser; no file access,
 * no JavaScript bridge, no mixed content, TLS errors never bypassed.
 */
class OwnerActivity : ComponentActivity() {

    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val home = Uri.parse(BuildConfig.OWNER_WEB_URL)
        setContent {
            MorbeezTheme(darkBars = false) {
                OwnerScreen(home = home, onCreated = { webView = it }, onExit = { finish() })
            }
        }
    }

    override fun onPause() {
        super.onPause()
        // Keeps the owner signed in if Android ends the process in the background.
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}

@Composable
private fun OwnerScreen(home: Uri, onCreated: (WebView) -> Unit, onExit: () -> Unit) {
    var progress by remember { mutableIntStateOf(0) }
    var unreachable by remember { mutableStateOf(false) }
    var view by remember { mutableStateOf<WebView?>(null) }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                ownerWebView(
                    context = context,
                    home = home,
                    onProgress = { progress = it },
                    onUnreachable = { unreachable = true },
                ).also {
                    view = it
                    onCreated(it)
                    it.loadUrl(home.toString())
                }
            },
        )

        // Back goes back through the owner's own pages first; from the first
        // page it returns to the launcher.
        BackHandler {
            val current = view
            if (current != null && current.canGoBack()) current.goBack() else onExit()
        }

        if (progress in 1..99 && !unreachable) {
            LinearProgressIndicator(
                progress = { progress / 100f },
                color = Fresh.primary,
                trackColor = Fresh.primaryTint,
                modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter),
            )
        }

        if (unreachable) {
            Unreachable(onRetry = {
                unreachable = false
                view?.reload()
            })
        }
    }
}

@Composable
private fun Unreachable(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().background(Fresh.bg).padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(72.dp).clip(RoundedCornerShape(24.dp)).background(Fresh.carbon),
            contentAlignment = Alignment.Center,
        ) {
            GlyphIcon(Glyph.Tower, Fresh.accent, size = 32.dp)
        }
        Text(
            "Can't reach Morbeez",
            style = MaterialTheme.typography.headlineSmall,
            color = Fresh.ink,
            modifier = Modifier.padding(top = 20.dp),
        )
        Text(
            "Check the phone's internet connection, then try again.",
            style = MaterialTheme.typography.bodyMedium,
            color = Fresh.inkMuted,
            modifier = Modifier.padding(top = 6.dp),
        )
        PrimaryAction("Try again", onClick = onRetry, glyph = Glyph.Sync, modifier = Modifier.padding(top = 28.dp))
    }
}

@SuppressLint("SetJavaScriptEnabled") // The owner app is a React app; it's the only site this view loads.
private fun ownerWebView(
    context: Context,
    home: Uri,
    onProgress: (Int) -> Unit,
    onUnreachable: () -> Unit,
): WebView = WebView(context).apply {
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        allowFileAccess = false
        allowContentAccess = false
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        setSupportMultipleWindows(false)
        // Lets the web app tell it's inside the app, should it need to.
        userAgentString = "$userAgentString MorbeezApp/${BuildConfig.VERSION_NAME}"
    }
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)

    webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (sameOrigin(request.url, home)) return false
            openOutside(view.context, request.url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            onProgress(1)
        }

        // Once signed in, Back must not lead to the sign-in page again: history
        // is cleared on the first page after /login, so Back from there exits
        // to the launcher. (The same after signing out and back in.)
        private var leavingLogin = false

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            val path = url?.let { Uri.parse(it).path } ?: return
            if (path.startsWith("/login")) {
                leavingLogin = true
            } else if (leavingLogin) {
                leavingLogin = false
                view.clearHistory()
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            // Only the page itself failing to load is "offline"; a failed image isn't.
            if (request.isForMainFrame) onUnreachable()
        }
    }
    webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) = onProgress(newProgress)
    }

    // The owner app creates one download itself (the GST e-invoice JSON, from
    // a blob), which only a browser can save.
    setDownloadListener { _, _, _, _, _ ->
        Toast.makeText(context, "Download this file from Morbeez in a computer's browser.", Toast.LENGTH_LONG).show()
    }
}

private fun sameOrigin(url: Uri, home: Uri): Boolean =
    url.scheme == home.scheme && url.host == home.host && url.port == home.port

private fun openOutside(context: Context, url: Uri) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, "No app on this phone can open that link.", Toast.LENGTH_SHORT).show()
    }
}
