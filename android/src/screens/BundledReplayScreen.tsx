import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Segmented } from '@/components/lab';
import { Notice } from '@/components/ui';
import type { RecordedTrace } from '@/hooks/useTraceRun';
import { colors, spacing } from '@/theme';
import SearchTreeScreen from './SearchTreeScreen';

/* Real traces recorded from the backend on the sample puzzle (same files the Jest replay tests use). */
const TRACES: Record<string, RecordedTrace> = {
  tot: require('../../assets/recorded/tot-sample.json'),
  multi: require('../../assets/recorded/multi-sample.json'),
};

/** Demo fallback when the backend or network fails: replays a bundled recorded trace, clearly labelled as such. */
export default function BundledReplayScreen() {
  const [which, setWhich] = useState<'tot' | 'multi'>('tot');
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="bundled-replay">
      <View style={{ padding: spacing.lg, paddingBottom: 0, gap: spacing.sm }}>
        <Notice kind="warning" testID="bundled-notice">Recorded replay: the events below were recorded earlier from the real backend and are bundled in the app. Nothing here is running now.</Notice>
        <Segmented testIDPrefix="bundled" value={which} onChange={setWhich}
          options={[{ value: 'tot', label: 'ToT (dead ends + backtracking)' }, { value: 'multi', label: 'Multi-agent + vote' }]} />
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{TRACES[which].source}</Text>
      </View>
      <SearchTreeScreen key={which} recorded={TRACES[which]} />
    </View>
  );
}
