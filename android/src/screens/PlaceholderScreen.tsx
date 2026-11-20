import React from 'react';
import { Card, EmptyState, Screen } from '@/components/ui';
import { Text } from 'react-native';
import { colors, fontSize } from '@/theme';

/** Honest placeholder for destinations built in later phases. It shows no fabricated data. */
export function PlaceholderScreen({ title, phase, uses }: { title: string; phase: string; uses: string }) {
  return (
    <Screen testID={`placeholder-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <Card>
        <EmptyState title={`${title} is coming in ${phase}`} body="This screen is not built yet, so nothing is shown here." />
        <Text style={{ color: colors.textMuted, fontSize: fontSize.xs, textAlign: 'center' }}>It will use: {uses}</Text>
      </Card>
    </Screen>
  );
}
