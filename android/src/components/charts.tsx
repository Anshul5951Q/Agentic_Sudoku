import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '@/theme';

export interface Bar { label: string; value: number | null; display: string; onPress?: () => void; testID?: string }

/**
 * One measure per chart (small multiples, never a dual axis). Single series, so one hue and no legend; every bar is
 * direct-labelled with its measured value (the table next to it is the accessible view). A null value is drawn as
 * "not measured", never as zero.
 */
export function BarChart({ title, unit, bars, testID }: { title: string; unit: string; bars: Bar[]; testID?: string }) {
  const max = Math.max(0, ...bars.map((b) => b.value ?? 0));
  return (
    <View style={styles.chart} testID={testID} accessible={false}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.unit}>{unit}</Text>
      {bars.map((b) => {
        const pct = b.value == null || max === 0 ? 0 : Math.max(2, (b.value / max) * 100);
        const body = (
          <View style={styles.row}>
            <Text style={styles.label} numberOfLines={2}>{b.label}</Text>
            <View style={styles.track}>
              {b.value == null ? <Text style={styles.na}>not measured</Text> : <View style={[styles.bar, { width: `${pct}%` }]} />}
            </View>
            <Text style={styles.value}>{b.display}</Text>
          </View>
        );
        return b.onPress ? (
          <Pressable key={b.label} testID={b.testID} accessibilityRole="button" accessibilityLabel={`${b.label}: ${b.display}. Open the recorded data`} onPress={b.onPress}>{body}</Pressable>
        ) : <View key={b.label} testID={b.testID} accessible accessibilityLabel={`${b.label}: ${b.display}`}>{body}</View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: 6, paddingVertical: spacing.sm },
  title: { color: colors.text, fontSize: fontSize.sm, fontWeight: '700' },
  unit: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: -4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  label: { color: colors.textMuted, fontSize: fontSize.xs, width: 96 },
  track: { flex: 1, height: 14, justifyContent: 'center' },
  bar: { height: 12, backgroundColor: colors.accent, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  na: { color: colors.textMuted, fontSize: fontSize.xs, fontStyle: 'italic' },
  value: { color: colors.text, fontSize: fontSize.xs, minWidth: 64, textAlign: 'right' },
});

export const tableStyles = StyleSheet.create({
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, minHeight: 36, alignItems: 'center' },
  th: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 4 },
  td: { color: colors.text, fontSize: fontSize.xs, paddingHorizontal: 6, paddingVertical: 4 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  bad: { color: colors.danger, fontWeight: '700' },
  good: { color: colors.verified, fontWeight: '700' },
  cellBox: { borderRadius: radius.sm },
});
