package com.morbeez.driver.ui.screens.launcher

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
                Text("Morbeez", style = MaterialTheme.typography.titleLarge, color = Fresh.onCarbon)
                Eyebrow("Vegetable trade, run live", color = Fresh.onCarbonFaint)
            }
        }

        Spacer(Modifier.height(56.dp))
        Text(
            buildAnnotatedString {
                append("One business.\n")
                withStyle(SpanStyle(color = Fresh.accent)) { append("Two ways in.") }
            },
            style = MaterialTheme.typography.displayMedium,
            color = Fresh.onCarbon,
        )
        Text(
            "Pick your workspace. Both share the same stock, trips and books, and stay in sync.",
            style = MaterialTheme.typography.bodyLarge,
            color = Fresh.onCarbonMuted,
            modifier = Modifier.padding(top = 14.dp),
        )

        Spacer(Modifier.height(36.dp))
        WorkspaceCard(
            glyph = Glyph.Tower,
            title = "Owner",
            kicker = "Control tower",
            description = "Orders, buying, trips, cash, workforce, vehicles, the books and AI suggestions.",
            featured = true,
            onClick = onOpenOwner,
        )
        Spacer(Modifier.height(12.dp))
        WorkspaceCard(
            glyph = Glyph.Truck,
            title = "Driver",
            kicker = "Field execution",
            description = "Today's route, proof of delivery and cash collected. Works offline.",
            featured = false,
            onClick = onOpenDriver,
        )

        Spacer(Modifier.height(28.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("Synced live")
            Chip("Offline-ready")
            Chip("Secure")
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
