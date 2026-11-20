import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, MIN_TOUCH, radius } from '@/theme';

interface Props {
  onDigit: (d: number) => void;
  onClear: () => void;
  disabled?: boolean;
}

export function NumberPad({ onDigit, onClear, disabled }: Props) {
  return (
    <View style={styles.row} testID="number-pad">
      {[1, 2, 3, 4].map((d) => (
        <Pressable
          key={d}
          testID={`pad-${d}`}
          accessibilityRole="button"
          accessibilityLabel={`Enter ${d}`}
          accessibilityState={{ disabled: !!disabled }}
          disabled={disabled}
          onPress={() => onDigit(d)}
          style={({ pressed }) => [styles.key, disabled && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.keyText}>{d}</Text>
        </Pressable>
      ))}
      <Pressable
        testID="pad-clear"
        accessibilityRole="button"
        accessibilityLabel="Clear selected cell"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onClear}
        style={({ pressed }) => [styles.key, styles.clearKey, disabled && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={styles.clearText}>Clear</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'stretch' },
  key: { flex: 1, minHeight: MIN_TOUCH + 8, maxWidth: 76, borderRadius: radius.md, backgroundColor: colors.accentStrong, alignItems: 'center', justifyContent: 'center' },
  clearKey: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, maxWidth: 92 },
  keyText: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },
  clearText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
