package com.morbeez.driver.ui.screens.login

import com.morbeez.driver.data.i18n.AppLanguage
import dagger.hilt.android.qualifiers.ApplicationContext
import android.content.Context
import androidx.annotation.StringRes
import com.morbeez.driver.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface LoginState {
    data object Idle : LoginState
    data object Loading : LoginState
    /**
     * [offerPin]: signed in with the password on a phone that has no PIN yet.
     * [languageChanged]: this person's language came from the server — redraw in it.
     */
    data class Success(val offerPin: Boolean, val languageChanged: Boolean = false) : LoginState
    data class Error(@StringRes val message: Int) : LoginState
}

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    @ApplicationContext private val appContext: Context,
) : ViewModel() {

    private val _state = MutableStateFlow<LoginState>(LoginState.Idle)
    val state: StateFlow<LoginState> = _state.asStateFlow()

    /** The number with a PIN on this phone; null when there's none (or it was switched off). */
    private val _pinLogin = MutableStateFlow(authRepository.pinLogin)
    val pinLogin: StateFlow<String?> = _pinLogin.asStateFlow()

    fun login(phone: String, password: String) {
        _state.value = LoginState.Loading
        viewModelScope.launch {
            runCatching { authRepository.login(phone, password) }
                .onSuccess { _state.value = LoginState.Success(offerPin = authRepository.pinLogin == null, languageChanged = syncLanguage()) }
                .onFailure { _state.value = LoginState.Error(explain(it)) }
        }
    }

    fun loginWithPin(pin: String) {
        _state.value = LoginState.Loading
        viewModelScope.launch {
            runCatching { authRepository.loginWithPin(pin) }
                .onSuccess { _state.value = LoginState.Success(offerPin = false, languageChanged = syncLanguage()) }
                .onFailure { error ->
                    val switchedOff = error is retrofit2.HttpException && error.code() == 401 &&
                        error.response()?.errorBody()?.string()?.contains("switched off") == true
                    if (switchedOff) {
                        authRepository.forgetPin()
                        _pinLogin.value = null
                        _state.value = LoginState.Error(R.string.err_pin_off)
                    } else {
                        _state.value = LoginState.Error(explainPin(error))
                    }
                }
        }
    }

    /**
     * The person's language, per user (client Q&A): a choice made on this
     * phone goes to the server; with none, the one they chose before
     * (on any phone) is adopted. True when the app must redraw.
     */
    private suspend fun syncLanguage(): Boolean {
        val chosen = AppLanguage.chosen(appContext)
        if (chosen != null) {
            authRepository.saveLanguage(chosen)
            return false
        }
        val theirs = authRepository.serverLanguage() ?: return false
        if (theirs == AppLanguage.current(appContext)) return false
        AppLanguage.choose(appContext, theirs)
        return true
    }

    /** "Use password instead" — the PIN stays set for next time. */
    fun usePassword() {
        _pinLogin.value = null
        _state.value = LoginState.Idle
    }

    // What went wrong, in words a driver can act on — not "HTTP 401".
    private fun explain(error: Throwable): Int = when {
        error is retrofit2.HttpException && error.code() == 401 -> R.string.err_wrong_login
        error is retrofit2.HttpException && error.code() == 429 -> R.string.err_too_many
        error is retrofit2.HttpException && error.code() == 400 -> R.string.err_enter_login
        error is java.io.IOException -> R.string.err_offline
        else -> R.string.err_sign_in
    }

    private fun explainPin(error: Throwable): Int = when {
        error is retrofit2.HttpException && error.code() == 401 -> R.string.err_wrong_pin
        error is retrofit2.HttpException && error.code() == 429 -> R.string.err_too_many
        error is java.io.IOException -> R.string.err_offline
        else -> R.string.err_sign_in
    }
}
