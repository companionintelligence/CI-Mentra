// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/components/TabBar.tsx. Modified for Companion; see mobile/README.md#attribution.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space, usePalette } from '../theme';

export type TabKey = 'glasses' | 'events' | 'console';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'glasses', label: 'Glasses' },
  { key: 'events', label: 'Events' },
  { key: 'console', label: 'Console' },
];

export function TabBar({
  active,
  onChange,
  badges,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  badges?: Partial<Record<TabKey, number>>;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { backgroundColor: palette.card, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const badge = badges?.[tab.key] ?? 0;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={badge > 0 ? `${tab.label}, ${badge} new` : tab.label}
            onPress={() => onChange(tab.key)}
            style={styles.tab}>
            <View style={[styles.indicator, { backgroundColor: selected ? palette.primary : 'transparent' }]} />
            <Text style={[styles.label, { color: selected ? palette.foreground : palette.mutedForeground, fontWeight: selected ? '700' : '500' }]}>
              {tab.label}
              {badge > 0 ? ` · ${badge > 99 ? '99+' : badge}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.xs,
  },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 6 },
  indicator: { width: 28, height: 3, borderRadius: 2 },
  label: { fontSize: 15 },
});
