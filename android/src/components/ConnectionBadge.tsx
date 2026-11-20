import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius } from '@/theme';
import { useConnection, type Level } from '@/state/ConnectionContext';

const LABEL: Record<Level, string> = { checking: 'checking', up: 'connected', degraded: 'limited', down: 'unreachable', unknown: 'unknown' };
const COLOR: Record<Level, string> = { checking: colors.textMuted, up: colors.success, degraded: colors.warning, down: colors.danger, unknown: colors.textMuted };

export function StatusDot({ level, name, testID }: { level: Level; name: string; testID?: string }) {
  return (
    <View testID={testID} style={styles.pill} accessible accessibilityLabel={`${name}: ${LABEL[level]}`}>
      <View style={[styles.dot, { backgroundColor: COLOR[level] }]} />
      <Text style={styles.text}>{name}</Text>
    </View>
  );
}

/** Header indicator: backend and Ollama are reported separately (and the app itself is, by definition, running). */
export function ConnectionBadge() {
  const { backend, ollama } = useConnection();
  return (
    <View style={styles.row} testID="connection-badge">
      <StatusDot level={backend} name="API" testID="badge-backend" />
      <StatusDot level={ollama} name="LLM" testID="badge-ollama" />
    </View>
  );
}

export { LABEL as LEVEL_LABEL, COLOR as LEVEL_COLOR };

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { color: colors.text, fontSize: fontSize.xs, fontWeight: '600' },
});
