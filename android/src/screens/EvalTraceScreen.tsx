import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { errText } from '@/components/lab';
import { Button, Card, Loading, Notice, Screen, SectionTitle } from '@/components/ui';
import { shareJson } from '@/services/share';
import { useConnection } from '@/state/ConnectionContext';
import { colors, fontSize } from '@/theme';
import type { EvaluationTrace } from '@/types/api';

const MAX_CHARS = 12000;

/** The recorded data behind one evaluation metric, exactly as stored by the evaluation job. */
export default function EvalTraceScreen() {
  const { e, k } = useLocalSearchParams<{ e: string; k: string }>();
  const { api } = useConnection();
  const [t, setT] = useState<EvaluationTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.evaluationTrace(String(e), String(k)).then(setT).catch((x) => setError(errText(x))); }, [api, e, k]);
  if (error) return <Screen testID="evtrace-error"><Notice kind="error">{error}</Notice></Screen>;
  if (!t) return <Screen><Loading label="Loading recorded data…" /></Screen>;
  const text = JSON.stringify(t.data, null, 1);
  return (
    <Screen testID="evtrace-screen">
      <Card>
        <SectionTitle>{t.trace_key}</SectionTitle>
        <Text style={{ color: colors.warning, fontSize: fontSize.xs, fontWeight: '800' }} testID="evtrace-label">RECORDED evaluation data from {t.evaluation_id} (not a live run)</Text>
        <Button testID="evtrace-export" label="Export JSON" variant="secondary" onPress={async () => setMsg((await shareJson(`${t.evaluation_id}-${t.trace_key}.json`, t)) ? 'Exported.' : 'Export cancelled.')} />
        {msg && <Notice kind="info">{msg}</Notice>}
      </Card>
      <Card>
        <Text selectable style={{ color: colors.text, fontSize: fontSize.xs, fontFamily: 'monospace' }} testID="evtrace-json">
          {text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + `\n… (${text.length - MAX_CHARS} more characters; use Export JSON for the full record)` : text}
        </Text>
      </Card>
    </Screen>
  );
}
