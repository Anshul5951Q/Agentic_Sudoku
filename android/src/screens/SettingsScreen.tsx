import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Notice, Screen, SectionTitle } from '@/components/ui';
import { LEVEL_LABEL } from '@/components/ConnectionBadge';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize, radius, spacing } from '@/theme';

const SOURCE_TEXT = {
  settings: 'saved in Settings',
  env: 'EXPO_PUBLIC_API_BASE_URL',
  'expo-dev-host': 'derived from the Expo dev server host',
  'emulator-default': 'Android emulator alias for the host machine',
  'local-default': 'local default',
} as const;

export default function SettingsScreen() {
  const { baseUrl, urlSource, backend, ollama, runtime, refresh, setBaseUrlOverride } = useConnection();
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  const save = async () => {
    const ok = await setBaseUrlOverride(draft);
    setMsg(ok ? { kind: 'success', text: draft.trim() ? 'Backend address saved.' : 'Using the default address again.' }
      : { kind: 'error', text: 'Enter a full address such as http://<host>:8000 (http or https, no path).' });
  };

  return (
    <Screen testID="settings-screen">
      <Card>
        <SectionTitle>Backend connection</SectionTitle>
        <Text style={styles.line} testID="settings-url">Address: {baseUrl}</Text>
        <Text style={styles.sub}>Source: {SOURCE_TEXT[urlSource]}</Text>
        <Text style={styles.line} testID="settings-backend">Backend: {LEVEL_LABEL[backend]}</Text>
        <TextInput testID="url-input" value={draft} onChangeText={setDraft} placeholder="Override, e.g. http://<computer-address>:8000"
          placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />
        <View style={styles.row}>
          <Button testID="url-save" label="Save address" onPress={save} />
          <Button testID="url-reset" label="Use default" variant="secondary" onPress={() => { setDraft(''); setBaseUrlOverride(null).then(() => setMsg({ kind: 'info', text: 'Using the default address.' })); }} />
        </View>
        <Button testID="url-test" label="Test connection" variant="secondary" onPress={refresh} />
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <Text style={styles.sub}>On a physical phone the app finds your computer through the Expo dev server automatically. Otherwise set the address of the computer running the backend (it must listen on your network: SUDOKU_API_HOST=0.0.0.0).</Text>
      </Card>

      <Card>
        <SectionTitle>Ollama and models</SectionTitle>
        <Text style={styles.line}>Ollama: {LEVEL_LABEL[ollama]}</Text>
        {runtime ? (
          <>
            {runtime.models.map((m) => (
              <Text key={m.name} style={styles.line}>{m.name}: {m.status === 'up' ? 'installed' : 'missing'}{m.detail ? ` (${m.detail})` : ''}</Text>
            ))}
            <Text style={styles.line}>Vector store: {runtime.vector_store.status}{runtime.vector_store.detail ? ` (${runtime.vector_store.detail})` : ''}</Text>
            <Text style={styles.line}>Database: {runtime.database.status}</Text>
          </>
        ) : (
          <Text style={styles.sub}>Runtime details are provided by the backend and are unavailable while it is unreachable.</Text>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { color: colors.text, fontSize: fontSize.sm },
  sub: { color: colors.textMuted, fontSize: fontSize.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, minHeight: 48, backgroundColor: colors.surfaceAlt },
});
