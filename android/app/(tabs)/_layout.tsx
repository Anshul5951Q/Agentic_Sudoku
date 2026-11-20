import { router, Tabs } from 'expo-router';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { ConnectionBadge } from '@/components/ConnectionBadge';
import { TABS } from '@/navigation/tabs';
import { colors } from '@/theme';

function HeaderRight() {
  return (
    <>
      <ConnectionBadge />
      <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')}
        style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 22 }}>⚙️</Text>
      </Pressable>
    </>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerRight: () => <HeaderRight />,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name}
          options={{ title: t.title, tabBarAccessibilityLabel: `${t.title} tab`, tabBarButtonTestID: `tab-${t.name}`, tabBarIcon: () => <Text style={{ fontSize: 20 }}>{t.glyph}</Text> }} />
      ))}
    </Tabs>
  );
}
