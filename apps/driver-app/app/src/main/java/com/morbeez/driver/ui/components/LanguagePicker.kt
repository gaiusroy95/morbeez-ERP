package com.morbeez.driver.ui.components

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.morbeez.driver.R
import com.morbeez.driver.data.i18n.AppLanguage
import com.morbeez.driver.data.repository.AuthRepository
import com.morbeez.driver.ui.theme.Fresh
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.launch

@HiltViewModel
class LanguageViewModel @Inject constructor(private val auth: AuthRepository) : ViewModel() {
    /** Saved on the phone at once; on the server too when someone is signed in. */
    fun save(code: String) {
        viewModelScope.launch { auth.saveLanguage(code) }
    }
}

/**
 * The language switch (client Q&A: English, Malayalam, Kannada, Tamil, per
 * user): a small pill showing the current language in its own script; tap
 * for the four. Choosing one redraws the screen in it.
 */
@Composable
fun LanguagePill(onDark: Boolean, viewModel: LanguageViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val current = AppLanguage.current(context)
    var open by remember { mutableStateOf(false) }
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(if (onDark) Color.White.copy(alpha = 0.10f) else Fresh.surface)
            .border(1.dp, if (onDark) Color.White.copy(alpha = 0.18f) else Fresh.borderStrong, RoundedCornerShape(50))
            .clickable(role = Role.Button) { open = true }
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            AppLanguage.CHOICES.first { it.first == current }.second,
            style = MaterialTheme.typography.labelMedium,
            color = if (onDark) Fresh.onCarbon else Fresh.ink,
        )
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            containerColor = Fresh.surface,
            title = { Text(stringResource(R.string.language_choose), style = MaterialTheme.typography.titleLarge, color = Fresh.ink) },
            text = {
                Column {
                    AppLanguage.CHOICES.forEach { (code, name) ->
                        val on = code == current
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(if (on) Fresh.carbon else Fresh.surface2)
                                .clickable(role = Role.RadioButton) {
                                    open = false
                                    if (!on) {
                                        AppLanguage.choose(context, code)
                                        viewModel.save(code)
                                        (context as? Activity)?.recreate()
                                    }
                                }
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (on) {
                                GlyphIcon(Glyph.Check, Fresh.accent, size = 16.dp)
                                Spacer(Modifier.width(10.dp))
                            }
                            Text(name, style = MaterialTheme.typography.titleMedium, color = if (on) Fresh.onCarbon else Fresh.ink)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel), color = Fresh.inkMuted) }
            },
        )
    }
}
