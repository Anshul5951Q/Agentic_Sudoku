import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, fontSize, MIN_TOUCH, radius, spacing } from '@/theme';

export function Screen({ children, scroll = true, testID }: { children: React.ReactNode; scroll?: boolean; testID?: string }) {
  if (!scroll) return <View testID={testID} style={styles.screen}>{children}</View>;
  return (
    <ScrollView testID={testID} style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: ViewStyle; testID?: string }) {
  return <View testID={testID} style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle} accessibilityRole="header">{children}</Text>;
}

export function Button({
  label, onPress, variant = 'primary', disabled, testID, hint,
}: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; testID?: string; hint?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, styles[`btn_${variant}` as const], disabled && styles.btnDisabled, pressed && { opacity: 0.8 }]}
    >
      <Text style={[styles.btnText, variant === 'ghost' && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function StatCard({ label, value, hint, testID }: { label: string; value: string; hint?: string; testID?: string }) {
  return (
    <View testID={testID} style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ kind, children, testID }: { kind: 'info' | 'success' | 'warning' | 'error'; children: React.ReactNode; testID?: string }) {
  const c = { info: colors.info, success: colors.verified, warning: colors.warning, error: colors.danger }[kind];
  return (
    <View testID={testID} accessibilityRole="alert" style={[styles.notice, { borderColor: c, backgroundColor: kind === 'error' ? colors.dangerSoft : colors.surfaceAlt }]}>
      <Text style={[styles.noticeText, { color: kind === 'error' ? '#FECACA' : colors.text }]}>{children}</Text>
    </View>
  );
}

export function EmptyState({ title, body, testID }: { title: string; body: string; testID?: string }) {
  return (
    <View testID={testID} style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading} testID="loading" accessibilityLabel={label}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  btn: { minHeight: MIN_TOUCH, borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  btn_primary: { backgroundColor: colors.accentStrong },
  btn_secondary: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  btn_danger: { backgroundColor: '#7F1D1D' },
  btn_ghost: { backgroundColor: 'transparent' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: 84 },
  statValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  statHint: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  noticeText: { fontSize: fontSize.sm },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
  loading: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  muted: { color: colors.textMuted },
});
