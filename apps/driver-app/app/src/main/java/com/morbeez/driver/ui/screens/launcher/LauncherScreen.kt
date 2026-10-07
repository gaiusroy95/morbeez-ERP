package com.morbeez.driver.ui.screens.launcher

import com.morbeez.driver.ui.components.LanguagePill
import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.morbeez.driver.ui.components.Eyebrow
import com.morbeez.driver.ui.components.Glyph
import com.morbeez.driver.ui.components.GlyphIcon
import com.morbeez.driver.ui.theme.Fresh

/**
 * The first screen: one install, two workspaces. The card chosen here only
 * decides which sign-in the person sees — what they can do after it is
 * decided by the server for that account, never by this choice.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LauncherScreen(onOpenOwner: () -> Unit, onOpenDriver: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Fresh.carbon)
            .drawBehind {
                // Two soft lights: lime at the top right, emerald at the bottom left.
                drawRect(Brush.radialGradient(listOf(Fresh.accent.copy(alpha = 0.20f), Color.Transparent), Offset(size.width, 0f), size.width * 0.9f))
                drawRect(Brush.radialGradient(listOf(Color(0xFF2FB574).copy(alpha = 0.22f), Color.Transparent), Offset(0f, size.height), size.width))
            }
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Brush.linearGradient(listOf(Fresh.accent, Fresh.accentDeep))),
                contentAlignment = Alignment.Center,
            ) {
                GlyphIcon(Glyph.Leaf, Fresh.accentInk, size = 18.dp)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleLarge, color = Fresh.onCarbon)
                Eyebrow(stringResource(R.string.launcher_tagline), color = Fresh.onCarbonFaint)
            }
            Spacer(Modifier.weight(1f))
            LanguagePill(onDark = true)
        }

        Spacer(Modifier.height(56.dp))
        val headline2 = stringResource(R.string.launcher_headline_2)
        Text(
            buildAnnotatedString {
                append(stringResource(R.string.launcher_headline_1) + "\n")
                withStyle(SpanStyle(color = Fresh.accent)) { append(headline2) }
            },
            style = MaterialTheme.typography.displayMedium,
            color = Fresh.onCarbon,
        )
        Text(
            stringResource(R.string.launcher_intro),
            style = MaterialTheme.typography.bodyLarge,
            color = Fresh.onCarbonMuted,
            modifier = Modifier.padding(top = 14.dp),
        )

        Spacer(Modifier.height(36.dp))
        WorkspaceCard(
            glyph = Glyph.Tower,
            title = stringResource(R.string.launcher_owner),
            kicker = stringResource(R.string.launcher_owner_kicker),
            description = stringResource(R.string.launcher_owner_desc),
            featured = true,
            onClick = onOpenOwner,
        )
        Spacer(Modifier.height(12.dp))
        WorkspaceCard(
            glyph = Glyph.Truck,
            title = stringResource(R.string.launcher_driver),
            kicker = stringResource(R.string.field_execution),
            description = stringResource(R.string.launcher_driver_desc),
            featured = false,
            onClick = onOpenDriver,
        )

        Spacer(Modifier.height(28.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(stringResource(R.string.chip_synced))
            Chip(stringResource(R.string.chip_offline))
            Chip(stringResource(R.string.chip_secure))
        }
    }
}

@Composable
private fun WorkspaceCard(
    glyph: Glyph,
    title: String,
    kicker: String,
    description: String,
    featured: Boolean,
    onClick: () -> Unit,
) {
    val titleColor = if (featured) Fresh.accentInk else Fresh.onCarbon
    val bodyColor = if (featured) Fresh.accentInk.copy(alpha = 0.72f) else Fresh.onCarbonMuted
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = if (featured) Fresh.accent else Fresh.carbon2,
        border = if (featured) null else BorderStroke(1.dp, Fresh.carbonLine),
        modifier = Modifier.fillMaxWidth(),
    ) {
        // Inside the Surface, so the ripple is clipped to the card; a screen
        // reader reads the card's text as one button.
        Column(
            Modifier
                .clickable(role = Role.Button, onClick = onClick)
                .then(
                    if (featured) {
                        Modifier.drawBehind {
                            drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.45f), Color.Transparent), Offset(size.width, 0f), size.width * 0.8f))
                        }
                    } else {
                        Modifier
                    },
                )
                .padding(22.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(46.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (featured) Fresh.carbon else Fresh.carbon3),
                    contentAlignment = Alignment.Center,
                ) {
                    GlyphIcon(glyph, Fresh.accent, size = 22.dp)
                }
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(if (featured) Fresh.carbon else Fresh.accent),
                    contentAlignment = Alignment.Center,
                ) {
                    GlyphIcon(Glyph.Arrow, if (featured) Fresh.accent else Fresh.accentInk, size = 18.dp)
                }
            }
            Text(
                title,
                style = MaterialTheme.typography.displaySmall,
                color = titleColor,
                modifier = Modifier.padding(top = 26.dp),
            )
            Eyebrow(kicker, color = bodyColor, modifier = Modifier.padding(top = 4.dp))
            Text(
                description,
                style = MaterialTheme.typography.bodyMedium,
                color = bodyColor,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

@Composable
private fun Chip(text: String) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(Fresh.carbon2)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(Fresh.accent))
        Spacer(Modifier.width(7.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = Fresh.onCarbonMuted)
    }
}
