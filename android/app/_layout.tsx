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
        </Stack>
      </ConnectionProvider>
    </SafeAreaProvider>
  );
}
