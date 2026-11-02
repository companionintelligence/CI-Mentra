import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Hint, ScreenTitle } from '../components/ui';
import { formatClock, type InputFeedItem, type InputKind } from '../lib/feed';
import type { CompanionSession } from '../session/useCompanionSession';
import { monoFont, radius, space, usePalette, type Palette } from '../theme';

const KIND_LABEL: Record<InputKind, string> = {
  button: 'BUTTON',
  touch: 'TOUCH',
  swipe: 'SWIPE',
  head: 'HEAD',
};

function kindColor(palette: Palette, kind: InputKind): string {
  switch (kind) {
    case 'button':
      return palette.primary;
    case 'touch':
      return palette.info;
    case 'swipe':
      return palette.warning;
    case 'head':
      return palette.success;
  }
}

/** Live feed of button, touch, swipe and head-position events from the glasses. */
export function EventsScreen({ session }: { session: CompanionSession }) {
  const palette = usePalette();
  const { inputEvents, glasses } = session;
  return (
    <View style={styles.flex}>
      <ScreenTitle
        title="Events"
        subtitle={glasses.connected ? 'Live input from your glasses' : 'Connect glasses to see their input'}
        right={
          inputEvents.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={session.clearInputEvents} hitSlop={8} style={styles.clear}>
              <Text style={[styles.clearLabel, { color: palette.primary }]}>Clear</Text>
            </Pressable>
          ) : null
        }
      />
      <FlatList
        data={inputEvents}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <EventRow item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Hint>
              Press the button or use the touchpad on your glasses. Each press, tap, swipe and head
              movement the glasses report shows up here, newest first.
            </Hint>
          </View>
        }
      />
    </View>
  );
}

function EventRow({ item }: { item: InputFeedItem }) {
  const palette = usePalette();
  const color = kindColor(palette, item.kind);
  return (
    <View
      accessible
      accessibilityLabel={`${item.title}, ${item.detail}, at ${formatClock(item.at)}`}
      style={[styles.row, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <Text style={[styles.tag, { color, borderColor: color }]}>{KIND_LABEL[item.kind]}</Text>
      <View style={styles.flex}>
        <Text style={[styles.title, { color: palette.foreground }]}>{item.title}</Text>
        <Text style={[styles.detail, { color: palette.mutedForeground }]}>{item.detail}</Text>
      </View>
      <Text style={[styles.time, { color: palette.mutedForeground }]}>{formatClock(item.at)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  empty: { paddingTop: space.lg },
  clear: { minHeight: 44, justifyContent: 'center' },
  clearLabel: { fontSize: 16, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    minWidth: 62,
    textAlign: 'center',
  },
  title: { fontSize: 16, fontWeight: '600' },
  detail: { fontSize: 13, marginTop: 2 },
  time: { fontSize: 12, fontFamily: monoFont },
});
