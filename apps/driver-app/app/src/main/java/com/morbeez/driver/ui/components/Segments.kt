package com.morbeez.driver.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.morbeez.driver.ui.theme.Fresh

/**
 * Tabs within a screen (This Trip / All Trips; Summary / Procurement / …):
 * up to three share the width, a long label on two lines; more scroll
 * sideways, each as wide as its words.
 */
@Composable
fun SegmentTabs(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    if (options.size <= 3) {
        // As tall as the tallest: a label on two lines doesn't leave the others short.
        Row(modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, label) -> Segment(label, value == selected, Modifier.weight(1f).fillMaxHeight(), maxLines = 2) { onSelect(value) } }
        }
    } else {
        Row(modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, label) -> Segment(label, value == selected, Modifier) { onSelect(value) } }
        }
    }
}

@Composable
private fun Segment(text: String, selected: Boolean, modifier: Modifier, maxLines: Int = 1, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Fresh.carbon else Fresh.surface)
            .border(1.dp, if (selected) Fresh.carbon else Fresh.borderStrong, RoundedCornerShape(14.dp))
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (selected) Fresh.onCarbon else Fresh.ink, textAlign = TextAlign.Center, maxLines = maxLines)
    }
}
