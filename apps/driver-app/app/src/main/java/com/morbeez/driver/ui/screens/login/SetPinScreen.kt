package com.morbeez.driver.ui.screens.login

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import com.morbeez.driver.data.repository.AuthRepository
import com.morbeez.driver.ui.components.Callout
import com.morbeez.driver.ui.components.CarbonHeader
import com.morbeez.driver.ui.components.FreshTextField
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.PrimaryAction
import com.morbeez.driver.ui.components.SecondaryAction
import com.morbeez.driver.ui.components.Tone
import com.morbeez.driver.ui.theme.Fresh
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

@HiltViewModel
class SetPinViewModel @Inject constructor(private val authRepository: AuthRepository) : ViewModel() {
    suspend fun save(pin: String): Result<Unit> = runCatching { authRepository.setPin(pin) }
}

/**
 * Right after a password sign-in on a phone with no PIN: a 4–6 digit PIN
 * for signing in here from now on (client Q&A: "PIN on the driver's own
 * registered phone"). Optional — "Not now" goes straight to the route.
 */
@Composable
fun SetPinScreen(onDone: () -> Unit, viewModel: SetPinViewModel = hiltViewModel()) {
    var pin by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // Read here: the button's callbacks aren't composable.
    val mismatch = stringResource(R.string.pin_mismatch)
    val weak = stringResource(R.string.pin_weak)
    val failed = stringResource(R.string.pin_failed)

    Column(Modifier.fillMaxSize().background(Fresh.bg).imePadding()) {
        CarbonHeader(title = stringResource(R.string.pin_title), eyebrow = stringResource(R.string.pin_eyebrow)) {
            Text(
                stringResource(R.string.pin_intro),
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
            FreshTextField(
                value = pin,
                onValueChange = { pin = it.filter { c -> c.isDigit() }.take(6) },
                label = stringResource(R.string.pin_new),
                keyboardType = KeyboardType.NumberPassword,
                visualTransformation = PasswordVisualTransformation(),
                leading = Glyph.Lock,
            )
            Spacer(Modifier.height(12.dp))
            FreshTextField(
                value = again,
                onValueChange = { again = it.filter { c -> c.isDigit() }.take(6) },
                label = stringResource(R.string.pin_again),
                keyboardType = KeyboardType.NumberPassword,
                visualTransformation = PasswordVisualTransformation(),
                leading = Glyph.Lock,
            )
            error?.let {
                Spacer(Modifier.height(12.dp))
                Callout(it, tone = Tone.Bad)
            }
            Spacer(Modifier.height(24.dp))
            PrimaryAction(
                text = stringResource(R.string.pin_save),
                enabled = pin.length >= 4 && again.isNotEmpty(),
                loading = saving,
                onClick = {
                    if (pin != again) {
                        error = mismatch
                        return@PrimaryAction
                    }
                    saving = true
                    scope.launch {
                        viewModel.save(pin)
                            .onSuccess { onDone() }
                            .onFailure {
                                saving = false
                                error = if (it is retrofit2.HttpException && it.code() == 400) {
                                    weak
                                } else {
                                    failed
                                }
                            }
                    }
                },
            )
            Spacer(Modifier.height(12.dp))
            SecondaryAction(text = stringResource(R.string.not_now), onClick = onDone)
        }
    }
}
