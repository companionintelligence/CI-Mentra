import { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { TabBar, type TabKey } from './components/TabBar';
import { ConsoleScreen } from './screens/ConsoleScreen';
import { EventsScreen } from './screens/EventsScreen';
import { GlassesScreen } from './screens/GlassesScreen';
import { useCompanionSession } from './session/useCompanionSession';
import { usePalette } from './theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

function AppShell() {
  const palette = usePalette();
  // One Bluetooth session for the whole app; it owns every SDK subscription.
  const session = useCompanionSession();
  const [tab, setTab] = useState<TabKey>('glasses');
  const [lastSeenEventId, setLastSeenEventId] = useState(0);
  const newestEventId = session.inputEvents[0]?.id ?? 0;

  useEffect(() => {
    if (tab === 'events') {
      setLastSeenEventId(newestEventId);
    }
  }, [tab, newestEventId]);

  const unseenEvents = session.inputEvents.filter((item) => item.id > lastSeenEventId).length;

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <StatusBar barStyle={palette.scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        {tab === 'glasses' ? <GlassesScreen session={session} /> : null}
        {tab === 'events' ? <EventsScreen session={session} /> : null}
        {tab === 'console' ? <ConsoleScreen session={session} /> : null}
      </SafeAreaView>
      <TabBar active={tab} onChange={setTab} badges={{ events: tab === 'events' ? 0 : unseenEvents }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
