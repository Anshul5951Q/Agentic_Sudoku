import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { board as B, colors, fontSize, MIN_TOUCH, radius, spacing } from '@/theme';

export function Segmented<T extends string>({ options, value, onChange, testIDPrefix = 'seg' }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; testIDPrefix?: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segRow}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} testID={`${testIDPrefix}-${o.value}`} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)} style={[styles.seg, on && styles.segOn]}>
            <Text style={[styles.segText, on && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const PILL: Record<string, string> = {
  idle: colors.textMuted, running: colors.info, waiting: colors.warning, completed: colors.success, failed: colors.danger,
  queued: colors.textMuted, paused: colors.warning, cancelled: colors.textMuted, interrupted: colors.warning,
  pending: colors.warning, approved: colors.success, rejected: colors.danger, blocked: colors.danger,
};

export function StatusPill({ status, testID }: { status: string; testID?: string }) {
  const c = PILL[status] ?? colors.textMuted;
  return (
    <View testID={testID} style={[styles.pill, { borderColor: c }]} accessible accessibilityLabel={`status ${status}`}>
      <View style={[styles.pillDot, { backgroundColor: c }]} />
      <Text style={styles.pillText}>{status}</Text>
    </View>
  );
}

export function MiniBoard({ values, highlight, size = 132, testID }: { values: number[][]; highlight?: [number, number] | null; size?: number; testID?: string }) {
  const cell = Math.floor(size / 4);
  return (
    <View testID={testID} style={[styles.mini, { width: cell * 4 + 4, height: cell * 4 + 4 }]} accessibilityLabel={`board ${values.map((r) => r.join('')).join('/')}`}>
      {values.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {row.map((v, c) => (
            <View key={c} style={{
              width: cell, height: cell, alignItems: 'center', justifyContent: 'center',
              backgroundColor: highlight && highlight[0] === r && highlight[1] === c ? B.selected : B.background,
              borderRightWidth: c === 3 ? 0 : c === 1 ? 2 : 1, borderBottomWidth: r === 3 ? 0 : r === 1 ? 2 : 1,
              borderRightColor: c === 1 ? B.boxLine : B.cellLine, borderBottomColor: r === 1 ? B.boxLine : B.cellLine,
            }}>
              <Text style={{ fontSize: cell * 0.5, color: B.clueText, fontWeight: '700' }}>{v ? v : ''}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function KV({ k, v, testID }: { k: string; v: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.kv} testID={testID}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

export function Chip({ label, on, onPress, testID, disabled }: { label: string; on?: boolean; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!disabled }} disabled={disabled}
      onPress={onPress} style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.4 }]}>
      <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export const errText = (e: unknown): string => {
  const m = (e as { message?: string })?.message;
  return m ? String(m) : 'Something went wrong.';
};
export const errCode = (e: unknown): string | null => (e as { code?: string })?.code ?? null;
export const isUnreachable = (e: unknown): boolean => !!(e as { unreachable?: boolean })?.unreachable;

const styles = StyleSheet.create({
  segRow: { gap: spacing.sm, paddingVertical: 2 },
  seg: { minHeight: MIN_TOUCH - 6, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  segOn: { backgroundColor: colors.accentStrong, borderColor: colors.accent },
  segText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '700' },
  mini: { borderWidth: 2, borderColor: B.boxLine, backgroundColor: B.background, borderRadius: 4, overflow: 'hidden' },
  kv: { flexDirection: 'row', gap: spacing.sm },
  k: { color: colors.textMuted, fontSize: fontSize.xs, width: 92 },
  v: { color: colors.text, fontSize: fontSize.xs, flex: 1 },
  chip: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accentStrong, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: fontSize.xs, fontWeight: '600' },
});
