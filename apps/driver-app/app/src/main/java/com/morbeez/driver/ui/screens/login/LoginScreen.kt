package com.morbeez.driver.ui.screens.login

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

@Composable
fun LoginScreen(onLoggedIn: () -> Unit, onBack: (() -> Unit)? = null, viewModel: LoginViewModel = hiltViewModel()) {
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(state) {
        if (state is LoginState.Success) onLoggedIn()
    }

    Column(Modifier.fillMaxSize().background(Fresh.bg).imePadding()) {
        CarbonHeader(title = "Driver sign in", eyebrow = "Field execution", onBack = onBack) {
            Text(
                "Your route, deliveries and cash, on the road.",
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
                GlyphIcon(Glyph.Truck, Fresh.accent, size = 26.dp)
            }
            Spacer(Modifier.height(20.dp))

            FreshTextField(
                value = phone,
                onValueChange = { phone = it },
                label = "Mobile number",
                keyboardType = KeyboardType.Phone,
                leading = Glyph.User,
                prefix = "+91",
            )
            Spacer(Modifier.height(12.dp))
            FreshTextField(
                value = password,
                onValueChange = { password = it },
                label = "Password",
                keyboardType = KeyboardType.Password,
                visualTransformation = PasswordVisualTransformation(),
                leading = Glyph.Lock,
            )

            val errorState = state
            if (errorState is LoginState.Error) {
                Spacer(Modifier.height(12.dp))
                Callout(errorState.message, tone = Tone.Bad)
            }

            Spacer(Modifier.height(24.dp))
            PrimaryAction(
                text = "Sign in",
                onClick = { viewModel.login(phone.trim(), password) },
                enabled = phone.isNotBlank() && password.isNotBlank(),
                loading = state is LoginState.Loading,
            )
            Text(
                "Forgot your password? Ask the business owner to reset it.",
                style = MaterialTheme.typography.bodySmall,
                color = Fresh.inkFaint,
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            )
        }
    }
}
