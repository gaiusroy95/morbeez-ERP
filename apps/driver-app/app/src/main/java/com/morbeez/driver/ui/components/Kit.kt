package com.morbeez.driver.ui.components

import androidx.compose.ui.res.stringResource
import com.morbeez.driver.R
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.morbeez.driver.ui.theme.Fresh

// ---------------------------------------------------------------------------
// Line icons, on a 24-unit grid with round caps: the same set and weight as
// the owner web app (apps/owner-app/src/components/ui/Icon.tsx).
// ---------------------------------------------------------------------------

enum class Glyph { Truck, Leaf, Back, Arrow, Sync, Camera, Rupee, Check, Warning, Pin, Box, Fuel, Pen, User, Lock, Tower, Logout }

@Composable
fun GlyphIcon(glyph: Glyph, tint: Color, modifier: Modifier = Modifier, size: Dp = 22.dp) {
    Canvas(modifier.size(size)) {
        val u = this.size.width / 24f
        val stroke = Stroke(width = 1.8f * u, cap = StrokeCap.Round, join = StrokeJoin.Round)
        drawGlyph(glyph, tint, u, stroke)
    }
}

private fun DrawScope.drawGlyph(glyph: Glyph, c: Color, u: Float, stroke: Stroke) {
    fun p(block: Path.() -> Unit) = drawPath(Path().apply(block), c, style = stroke)
    fun circle(x: Float, y: Float, r: Float) = drawCircle(c, r * u, Offset(x * u, y * u), style = stroke)
    fun Path.m(x: Float, y: Float) = moveTo(x * u, y * u)
    fun Path.l(x: Float, y: Float) = lineTo(x * u, y * u)
    when (glyph) {
        Glyph.Truck -> {
            p { m(3f, 6f); l(14f, 6f); l(14f, 16f); m(14f, 9f); l(18f, 9f); l(21f, 12.5f); l(21f, 16f); l(18.8f, 16f); m(3f, 6f); l(3f, 16f); l(5.2f, 16f); m(8.8f, 16f); l(15.2f, 16f) }
            circle(7f, 16.5f, 1.8f); circle(17f, 16.5f, 1.8f)
        }
        Glyph.Leaf -> p { m(5f, 19f); cubicTo(5f * u, 10f * u, 10f * u, 5f * u, 20f * u, 5f * u); cubicTo(20f * u, 15f * u, 15f * u, 20f * u, 6f * u, 20f * u); m(5f, 19f); l(12f, 12f) }
        Glyph.Back -> p { m(19f, 12f); l(5f, 12f); m(11f, 6f); l(5f, 12f); l(11f, 18f) }
        Glyph.Arrow -> p { m(5f, 12f); l(19f, 12f); m(13f, 6f); l(19f, 12f); l(13f, 18f) }
        Glyph.Sync -> {
            drawArc(c, -60f, 250f, false, Offset(5f * u, 5f * u), Size(14f * u, 14f * u), style = stroke)
            p { m(15.5f, 3.5f); l(16f, 6.2f); l(13.3f, 6.8f) }
        }
        Glyph.Camera -> {
            p { m(3f, 8f); l(7f, 8f); l(9f, 5f); l(15f, 5f); l(17f, 8f); l(21f, 8f); l(21f, 19f); l(3f, 19f); close() }
            circle(12f, 13f, 3.5f)
        }
        Glyph.Rupee -> p { m(6f, 4f); l(18f, 4f); m(6f, 8.5f); l(18f, 8.5f); m(6f, 4f); l(10f, 4f); cubicTo(15f * u, 4f * u, 15f * u, 13f * u, 10f * u, 13f * u); l(7f, 13f); l(15f, 20f) }
        Glyph.Check -> p { m(5f, 12.5f); l(10f, 17.5f); l(19f, 7f) }
        Glyph.Warning -> p { m(12f, 3.5f); l(21.5f, 20f); l(2.5f, 20f); close(); m(12f, 10f); l(12f, 14f); m(12f, 17f); l(12f, 17.01f) }
        Glyph.Pin -> {
            p { m(12f, 21f); cubicTo(12f * u, 21f * u, 19f * u, 14.5f * u, 19f * u, 9.5f * u); cubicTo(19f * u, 5.5f * u, 15.9f * u, 2.5f * u, 12f * u, 2.5f * u); cubicTo(8.1f * u, 2.5f * u, 5f * u, 5.5f * u, 5f * u, 9.5f * u); cubicTo(5f * u, 14.5f * u, 12f * u, 21f * u, 12f * u, 21f * u) }
            circle(12f, 9.5f, 2.5f)
        }
        Glyph.Box -> p { m(3f, 8f); l(12f, 3f); l(21f, 8f); l(21f, 16f); l(12f, 21f); l(3f, 16f); close(); m(3f, 8f); l(12f, 13f); l(21f, 8f); m(12f, 13f); l(12f, 21f) }
        Glyph.Fuel -> p { m(4f, 20f); l(4f, 5f); l(13f, 5f); l(13f, 20f); m(3f, 20f); l(14f, 20f); m(4f, 10f); l(13f, 10f); m(13f, 8f); l(17f, 11f); l(17f, 17f); cubicTo(17f * u, 18.5f * u, 20f * u, 18.5f * u, 20f * u, 17f * u); l(20f, 9f); l(17f, 6f) }
        Glyph.Pen -> p { m(4f, 20f); l(8f, 19f); l(19f, 8f); l(16f, 5f); l(5f, 16f); close(); m(14f, 7f); l(17f, 10f) }
        Glyph.User -> { circle(12f, 8f, 4f); p { m(4f, 21f); cubicTo(4f * u, 16.6f * u, 7.6f * u, 13f * u, 12f * u, 13f * u); cubicTo(16.4f * u, 13f * u, 20f * u, 16.6f * u, 20f * u, 21f * u) } }
        Glyph.Lock -> { p { m(5f, 11f); l(19f, 11f); l(19f, 21f); l(5f, 21f); close(); m(8f, 11f); l(8f, 7.5f); cubicTo(8f * u, 3f * u, 16f * u, 3f * u, 16f * u, 7.5f * u); l(16f, 11f) } }
        Glyph.Tower -> {
            drawCircle(c, 2f * u, Offset(12f * u, 12f * u))
            for (r in listOf(6f, 10f)) {
                val tl = Offset((12f - r) * u, (12f - r) * u)
                val sz = Size(2 * r * u, 2 * r * u)
                drawArc(c, 135f, 90f, false, tl, sz, style = stroke)
                drawArc(c, -45f, 90f, false, tl, sz, style = stroke)
            }
        }
        Glyph.Logout -> p { m(15f, 4f); l(18f, 4f); l(19f, 5f); l(19f, 19f); l(18f, 20f); l(15f, 20f); m(10f, 16f); l(14f, 12f); l(10f, 8f); m(14f, 12f); l(4f, 12f) }
    }
}

// ---------------------------------------------------------------------------
// Screen frames
// ---------------------------------------------------------------------------

/**
 * A driver screen: a carbon header (back, eyebrow, title, anything else the
 * screen puts there), then a light, scrolling body, then an optional action
 * pinned to the bottom where a thumb reaches it.
 */
@Composable
fun FieldScreen(
    title: String,
    eyebrow: String? = null,
    onBack: (() -> Unit)? = null,
    headerExtra: @Composable ColumnScope.() -> Unit = {},
    bottomBar: (@Composable () -> Unit)? = null,
    scroll: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Fresh.bg)) {
        CarbonHeader(title = title, eyebrow = eyebrow, onBack = onBack, extra = headerExtra)
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
        if (bottomBar != null) {
            Surface(color = Fresh.surface, shadowElevation = 12.dp) {
                Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp)) { bottomBar() }
            }
        }
    }
}

@Composable
fun CarbonHeader(
    title: String,
    eyebrow: String? = null,
    onBack: (() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp))
            .background(Fresh.carbon)
            .drawBehind { drawGlow() }
            .statusBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 22.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)) {
            if (onBack != null) {
                RoundIconButton(Glyph.Back, stringResource(R.string.back), onBack)
                Spacer(Modifier.width(10.dp))
            }
            if (eyebrow != null) Eyebrow(eyebrow, color = Fresh.onCarbonMuted, modifier = Modifier.weight(1f)) else Spacer(Modifier.weight(1f))
            trailing?.invoke(this)
        }
        Text(
            title,
            style = MaterialTheme.typography.headlineLarge,
            color = Fresh.onCarbon,
            modifier = Modifier.padding(top = 14.dp),
        )
        extra()
    }
}

/** The lime corner glow of the carbon frame, as on the web app's sidebar. */
fun DrawScope.drawGlow() {
    drawRect(
        Brush.radialGradient(
            listOf(Fresh.accent.copy(alpha = 0.16f), Color.Transparent),
            center = Offset(size.width, 0f),
            radius = size.maxDimension * 0.75f,
        ),
    )
}

@Composable
fun RoundIconButton(glyph: Glyph, description: String, onClick: () -> Unit, dark: Boolean = true, enabled: Boolean = true) {
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(if (dark) Fresh.carbon3 else Fresh.surface3)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = description, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        GlyphIcon(glyph, if (dark) Fresh.onCarbon else Fresh.ink, size = 20.dp)
    }
}

@Composable
fun Eyebrow(text: String, color: Color = Fresh.inkMuted, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = color, modifier = modifier)
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

@Composable
fun FieldCard(modifier: Modifier = Modifier, highlight: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = Fresh.surface,
        border = BorderStroke(if (highlight) 1.5.dp else 1.dp, if (highlight) Fresh.primary else Fresh.border),
        shadowElevation = if (highlight) 6.dp else 1.dp,
    ) {
        Column(Modifier.padding(18.dp), content = content)
    }
}

/** A numbered step in a flow ("1 · Who received it"). */
@Composable
fun StepTitle(number: Int, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
        Box(Modifier.size(26.dp).clip(CircleShape).background(Fresh.carbon), contentAlignment = Alignment.Center) {
            Text("$number", style = MaterialTheme.typography.labelMedium, color = Fresh.accent)
        }
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.titleMedium, color = Fresh.ink)
    }
}

enum class Tone { Neutral, Good, Active, Attention, Bad, Lime }

@Composable
fun Pill(text: String, tone: Tone = Tone.Neutral, onDark: Boolean = false) {
    val (bg, fg) = when (tone) {
        Tone.Neutral -> if (onDark) Fresh.carbon3 to Fresh.onCarbonMuted else Fresh.surface3 to Fresh.inkMuted
        Tone.Good -> Fresh.primaryTint to Fresh.good
        Tone.Active -> Fresh.infoTint to Fresh.info
        Tone.Attention -> Fresh.warningTint to Fresh.warning
        Tone.Bad -> Fresh.criticalTint to Fresh.critical
        Tone.Lime -> Fresh.accent to Fresh.accentInk
    }
    Row(
        Modifier.clip(CircleShape).background(bg).padding(start = 8.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(fg))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = fg)
    }
}

/** The one thing to do on this screen: tall, full width, easy with a gloved thumb. */
@Composable
fun PrimaryAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    glyph: Glyph? = Glyph.Arrow,
    danger: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.fillMaxWidth().height(58.dp),
        shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (danger) Fresh.critical else Fresh.carbon,
            contentColor = if (danger) Color.White else Fresh.onCarbon,
            disabledContainerColor = Fresh.surface3,
            disabledContentColor = Fresh.inkFaint,
        ),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(20.dp), color = Fresh.accent, strokeWidth = 2.dp)
            Spacer(Modifier.width(12.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f, fill = false))
        if (glyph != null && !loading) {
            Spacer(Modifier.width(12.dp))
            Box(
                Modifier.size(30.dp).clip(CircleShape).background(if (enabled) (if (danger) Color.White.copy(alpha = 0.2f) else Fresh.accent) else Color.Transparent),
                contentAlignment = Alignment.Center,
            ) {
                GlyphIcon(glyph, if (danger) Color.White else if (enabled) Fresh.accentInk else Fresh.inkFaint, size = 16.dp)
            }
        }
    }
}

@Composable
fun SecondaryAction(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, glyph: Glyph? = null, enabled: Boolean = true) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().height(54.dp),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, Fresh.borderStrong),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Fresh.surface, contentColor = Fresh.ink),
    ) {
        if (glyph != null) {
            GlyphIcon(glyph, Fresh.ink, size = 18.dp)
            Spacer(Modifier.width(10.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun FreshTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    singleLine: Boolean = true,
    leading: Glyph? = null,
    prefix: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        visualTransformation = visualTransformation,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        leadingIcon = leading?.let { { GlyphIcon(it, Fresh.inkMuted, size = 20.dp) } },
        prefix = prefix?.let { { Text("$it ", color = Fresh.inkMuted) } },
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Fresh.primary,
            unfocusedBorderColor = Fresh.borderStrong,
            focusedLabelColor = Fresh.primary,
            unfocusedContainerColor = Fresh.surface,
            focusedContainerColor = Fresh.surface,
            cursorColor = Fresh.primary,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** One choice from a few, as big tappable tiles that wrap onto new rows. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChoiceTiles(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            val on = value == selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (on) Fresh.carbon else Fresh.surface)
                    .border(1.dp, if (on) Fresh.carbon else Fresh.borderStrong, RoundedCornerShape(14.dp))
                    .clickable(role = Role.RadioButton) { onSelect(value) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (on) {
                        GlyphIcon(Glyph.Check, Fresh.accent, size = 16.dp)
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) Fresh.onCarbon else Fresh.ink)
                }
            }
        }
    }
}

/** A tinted note: information, a warning, or something that went wrong. */
@Composable
fun Callout(text: String, tone: Tone = Tone.Active, glyph: Glyph = Glyph.Warning) {
    val (bg, fg) = when (tone) {
        Tone.Attention -> Fresh.warningTint to Fresh.warning
        Tone.Bad -> Fresh.criticalTint to Fresh.critical
        Tone.Good -> Fresh.primaryTint to Fresh.primaryStrong
        else -> Fresh.infoTint to Fresh.info
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg).padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        GlyphIcon(glyph, fg, size = 18.dp)
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Fresh.ink)
    }
}

/** A label over a figure, for headline numbers. */
@Composable
fun Stat(label: String, value: String, onDark: Boolean = false, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = if (onDark) Fresh.onCarbonMuted else Fresh.inkMuted)
        Text(
            value,
            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            color = if (onDark) Fresh.onCarbon else Fresh.ink,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}
