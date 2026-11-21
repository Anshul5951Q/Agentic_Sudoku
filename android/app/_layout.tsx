import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectionProvider } from '@/state/ConnectionContext';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ConnectionProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'card' }} />
          <Stack.Screen name="run/[runId]" options={{ title: 'Run' }} />
          <Stack.Screen name="trace/[runId]" options={{ title: 'Search tree' }} />
          <Stack.Screen name="history/index" options={{ title: 'History' }} />
          <Stack.Screen name="history/[sessionId]" options={{ title: 'Session' }} />
          <Stack.Screen name="compare" options={{ title: 'Compare runs' }} />
          <Stack.Screen name="eval-trace" options={{ title: 'Recorded evaluation data' }} />
          <Stack.Screen name="replay" options={{ title: 'Recorded replay (offline)' }} />
        </Stack>
      </ConnectionProvider>
    </SafeAreaProvider>
  );
}
