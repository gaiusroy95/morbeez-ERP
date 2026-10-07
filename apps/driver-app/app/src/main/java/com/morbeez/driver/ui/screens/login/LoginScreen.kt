package com.morbeez.driver.ui.screens.login

import androidx.compose.ui.platform.LocalContext
import com.morbeez.driver.ui.components.LanguagePill
import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.CarbonHeader
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.theme.Fresh

/** "98000 00004" → "98••• ••004": enough to recognise, not to read off the screen. */
private fun masked(login: String): String {
    val digits = login.filter { it.isDigit() }.takeLast(10)
    return if (digits.length == 10) "+91 ${digits.take(2)}••• ••${digits.takeLast(3)}" else login
}

@Composable
fun LoginScreen(
    onLoggedIn: (offerPin: Boolean) -> Unit,
    onBack: (() -> Unit)? = null,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var pin by remember { mutableStateOf("") }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val pinLogin by viewModel.pinLogin.collectAsStateWithLifecycle()

    LaunchedEffect(state) {
        (state as? LoginState.Success)?.let {
            onLoggedIn(it.offerPin)
            if (it.languageChanged) (context as? android.app.Activity)?.recreate()
        }
    }

    Column(Modifier.fillMaxSize().background(Fresh.bg).imePadding()) {
        CarbonHeader(
            title = stringResource(R.string.login_title),
            eyebrow = stringResource(R.string.field_execution),
            onBack = onBack,
            trailing = { LanguagePill(onDark = true) },
        ) {
            Text(
                stringResource(R.string.login_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = Fresh.onCarbonMuted,
                modifier = Modifier.padding(top = 6.dp),
            )
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(20.dp),
        ) {
            Box(
                Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Fresh.carbon),
                contentAlignment = Alignment.Center,
            ) {
                GlyphIcon(if (pinLogin != null) Glyph.Lock else Glyph.Truck, Fresh.accent, size = 26.dp)
            }
            Spacer(Modifier.height(20.dp))

            val savedLogin = pinLogin
            if (savedLogin != null) {
                Text(stringResource(R.string.welcome_back), style = MaterialTheme.typography.titleLarge, color = Fresh.ink)
                Text(
                    stringResource(R.string.enter_pin_for, masked(savedLogin)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Fresh.inkMuted,
                    modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
                )
                FreshTextField(
                    value = pin,
                    onValueChange = { pin = it.filter { c -> c.isDigit() }.take(6) },
                    label = stringResource(R.string.pin),
                    keyboardType = KeyboardType.NumberPassword,
                    visualTransformation = PasswordVisualTransformation(),
                    leading = Glyph.Lock,
                )
            } else {
                FreshTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = stringResource(R.string.mobile_number),
                    keyboardType = KeyboardType.Phone,
                    leading = Glyph.User,
                    prefix = "+91",
                )
                Spacer(Modifier.height(12.dp))
                FreshTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = stringResource(R.string.password),
                    keyboardType = KeyboardType.Password,
                    visualTransformation = PasswordVisualTransformation(),
                    leading = Glyph.Lock,
                )
            }

            val errorState = state
            if (errorState is LoginState.Error) {
                Spacer(Modifier.height(12.dp))
                Callout(stringResource(errorState.message), tone = Tone.Bad)
            }

            Spacer(Modifier.height(24.dp))
            if (savedLogin != null) {
                PrimaryAction(
                    text = stringResource(R.string.sign_in),
                    onClick = { viewModel.loginWithPin(pin) },
                    enabled = pin.length >= 4,
                    loading = state is LoginState.Loading,
                )
                TextButton(onClick = { viewModel.usePassword() }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text(stringResource(R.string.use_password), color = Fresh.primary)
                }
            } else {
                PrimaryAction(
                    text = stringResource(R.string.sign_in),
                    onClick = { viewModel.login(phone.trim(), password) },
                    enabled = phone.isNotBlank() && password.isNotBlank(),
                    loading = state is LoginState.Loading,
                )
                Text(
                    stringResource(R.string.forgot_password),
                    style = MaterialTheme.typography.bodySmall,
                    color = Fresh.inkFaint,
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                )
            }
        }
    }
}
