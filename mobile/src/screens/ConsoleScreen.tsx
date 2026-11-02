// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/screens/ConsoleScreen.tsx. Modified for Companion; see mobile/README.md#attribution.
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, Hint, ScreenTitle } from '../components/ui';
import { filterLog, formatClock, type LogEntry, type LogFilter, type LogSource } from '../lib/feed';
import type { CompanionSession } from '../session/useCompanionSession';
import { monoFont, space, usePalette, type Palette } from '../theme';

const FILTERS: { key: LogFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sdk', label: 'SDK' },
  { key: 'app', label: 'App' },
  { key: 'error', label: 'Errors' },
];

function sourceColor(palette: Palette, source: LogSource): string {
  switch (source) {
    case 'sdk':
      return palette.info;
    case 'app':
      return palette.primary;
    case 'error':
      return palette.destructive;
  }
}

/**
 * The SDK's diagnostic log (`log` events) interleaved with this app's own actions and errors.
 * Kept in memory only, newest first, and never uploaded.
 */
export function ConsoleScreen({ session }: { session: CompanionSession }) {
  const palette = usePalette();
  const [filter, setFilter] = useState<LogFilter>('all');
  const entries = filterLog(session.log, filter);
  return (
    <View style={styles.flex}>
      <ScreenTitle
        title="Console"
        subtitle="SDK diagnostics and app actions"
        right={
          session.log.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={session.clearLog} hitSlop={8} style={styles.clear}>
              <Text style={[styles.clearLabel, { color: palette.primary }]}>Clear</Text>
            </Pressable>
          ) : null
        }
      />
      <View accessibilityRole="radiogroup" style={styles.filters}>
        {FILTERS.map((option) => (
          <Chip
            key={option.key}
            label={option.label}
            selected={filter === option.key}
            onPress={() => setFilter(option.key)}
          />
        ))}
      </View>
      <FlatList
        data={entries}
        keyExtractor={(entry) => String(entry.id)}
        renderItem={({ item }) => <LogRow entry={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Hint>Nothing logged yet. Scan or connect, and SDK diagnostics appear here.</Hint>
          </View>
        }
      />
    </View>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const palette = usePalette();
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.meta, { color: palette.mutedForeground }]}>{formatClock(entry.at)}</Text>
      <Text style={[styles.meta, styles.source, { color: sourceColor(palette, entry.source) }]}>
        {entry.source.toUpperCase()}
      </Text>
      <Text selectable style={[styles.message, { color: palette.foreground }]}>
        {entry.message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  filters: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  empty: { paddingTop: space.lg },
  clear: { minHeight: 44, justifyContent: 'center' },
  clearLabel: { fontSize: 16, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: { fontSize: 12, fontFamily: monoFont, paddingTop: 1 },
  source: { width: 44, fontWeight: '700' },
  message: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: monoFont },
});
