package com.morbeez.driver.ui.screens.login

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
    data object Success : LoginState
    data class Error(val message: String) : LoginState
}

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<LoginState>(LoginState.Idle)
    val state: StateFlow<LoginState> = _state.asStateFlow()

    fun login(phone: String, password: String) {
        _state.value = LoginState.Loading
        viewModelScope.launch {
            runCatching { authRepository.login(phone, password) }
                .onSuccess { _state.value = LoginState.Success }
                .onFailure { _state.value = LoginState.Error(explain(it)) }
        }
    }

    // What went wrong, in words a driver can act on — not "HTTP 401".
    private fun explain(error: Throwable): String = when {
        error is retrofit2.HttpException && error.code() == 401 -> "Wrong mobile number or password."
        error is retrofit2.HttpException && error.code() == 429 -> "Too many tries. Wait a few minutes, then try again."
        error is retrofit2.HttpException && error.code() == 400 -> "Enter your 10-digit mobile number and password."
        error is java.io.IOException -> "Can't reach Morbeez. Check the phone's internet, then try again."
        else -> "Couldn't sign in. Try again."
    }
}
