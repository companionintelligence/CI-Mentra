// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/screens/DeviceScreen.tsx. Modified for Companion; see mobile/README.md#attribution.
import type { Device } from '@mentra/bluetooth-sdk';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Banner,
  Button,
  ButtonRow,
  Card,
  Chip,
  Hint,
  InfoRow,
  ProgressBar,
  ScreenTitle,
  StatusPill,
} from '../components/ui';
import {
  batteryLabel,
  connectedNameLabel,
  firmwareLabel,
  hotspotLabel,
  lifecycleView,
  scanProgress,
  showsWifiStatus,
  signalLabel,
  wifiLabel,
  type Tone,
} from '../lib/glassesStatus';
import { SCAN_MODELS, scanModelLabel } from '../lib/models';
import type { CompanionSession } from '../session/useCompanionSession';
import { radius, space, usePalette } from '../theme';

const DISPLAY_TEXT_MAX_LENGTH = 120;

/** Re-renders on an interval while `intervalMs` is set, for the scan progress bar. */
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) {
      return undefined;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function GlassesScreen({ session }: { session: CompanionSession }) {
  const { glasses, notice, savedDevice } = session;
  const linkBusy = glasses.connection.state === 'connecting' || glasses.connection.state === 'bonding';
  const noticeTone: Tone = notice?.tone === 'info' ? 'progress' : (notice?.tone ?? 'neutral');

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenTitle title="Companion" subtitle="Your smart glasses, over Bluetooth" />
        {notice ? (
          <Banner
            tone={noticeTone}
            message={notice.message}
            onDismiss={session.dismissNotice}
            actionLabel={notice.openSettings ? 'Open Settings' : undefined}
            onAction={notice.openSettings ? session.openSettings : undefined}
          />
        ) : null}
        <StatusCard session={session} />
        {glasses.connected && session.display.available ? <DisplayCard session={session} /> : null}
        {!glasses.connected && !linkBusy && savedDevice ? <SavedGlassesCard session={session} device={savedDevice} /> : null}
        {!glasses.connected ? <FindGlassesCard session={session} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StatusCard({ session }: { session: CompanionSession }) {
  const palette = usePalette();
  const { glasses, connectedModel, display, busy } = session;
  const view = lifecycleView(glasses.connection);
  const linkBusy = glasses.connection.state === 'connecting' || glasses.connection.state === 'bonding';

  return (
    <Card title="Status">
      <StatusPill label={view.title} tone={view.tone} />
      <Text style={[styles.body, { color: palette.mutedForeground }]}>{view.detail}</Text>
      {glasses.connected ? (
        <View>
          <InfoRow label="Glasses" value={connectedNameLabel(glasses, session.savedDevice?.name)} />
          <InfoRow label="Model" value={connectedModel ?? glasses.device.deviceModel ?? 'Unknown'} />
          <InfoRow label="Battery" value={batteryLabel(glasses)} />
          <InfoRow label="Firmware" value={firmwareLabel(glasses)} />
          <InfoRow label="Signal" value={signalLabel(glasses)} />
          <InfoRow
            label="Display"
            value={display.available ? 'Available' : display.reason === 'not-ready' ? 'Waiting for boot' : 'None on this model'}
            last={!showsWifiStatus(glasses, connectedModel)}
          />
          {showsWifiStatus(glasses, connectedModel) ? (
            <>
              <InfoRow label="Wi-Fi" value={wifiLabel(glasses)} />
              <InfoRow label="Hotspot" value={hotspotLabel(glasses)} last />
            </>
          ) : null}
        </View>
      ) : null}
      {linkBusy ? (
        <ButtonRow>
          <Button label="Cancel" variant="secondary" onPress={() => void session.cancelConnecting()} />
        </ButtonRow>
      ) : null}
      {glasses.connected ? (
        <ButtonRow>
          <Button
            label="Disconnect"
            variant="danger"
            busy={busy === 'Disconnect'}
            disabled={busy !== null}
            onPress={() => void session.disconnect()}
          />
          <Button
            label="Forget"
            variant="secondary"
            disabled={busy !== null}
            accessibilityHint="Disconnects and removes these glasses from Companion"
            onPress={() => void session.forgetSaved()}
          />
        </ButtonRow>
      ) : null}
    </Card>
  );
}

function SavedGlassesCard({ session, device }: { session: CompanionSession; device: Device }) {
  const reconnectLabel = `Reconnect to ${device.name}`;
  return (
    <Card title="Saved glasses">
      <View>
        <InfoRow label="Name" value={device.name} />
        <InfoRow label="Model" value={device.model} last />
      </View>
      <ButtonRow>
        <Button
          label="Reconnect"
          busy={session.busy === reconnectLabel}
          disabled={session.busy !== null || session.scan.active}
          onPress={() => void session.reconnectSaved()}
        />
        <Button
          label="Forget"
          variant="secondary"
          disabled={session.busy !== null}
          accessibilityHint="Removes these glasses from Companion"
          onPress={() => void session.forgetSaved()}
        />
      </ButtonRow>
    </Card>
  );
}

function FindGlassesCard({ session }: { session: CompanionSession }) {
  const palette = usePalette();
  const { scan, busy } = session;
  const now = useNow(scan.active ? 250 : null);
  const progress = scanProgress(scan.startedAt, now, scan.timeoutMs);
  const selectedId = scan.selected?.id ?? null;
  const found = scan.devices.length;

  return (
    <Card title="Find glasses">
      <View accessibilityRole="radiogroup" style={styles.chipRow}>
        {SCAN_MODELS.map((model) => (
          <Chip
            key={model}
            label={scanModelLabel(model)}
            selected={scan.model === model}
            disabled={scan.active || busy !== null}
            onPress={() => session.selectScanModel(model)}
          />
        ))}
      </View>

      {scan.active ? (
        <View style={styles.scanStatus}>
          <ProgressBar progress={progress} label={`Scanning, ${found} found`} />
          <Text style={[styles.body, { color: palette.mutedForeground }]}>
            Searching for {scanModelLabel(scan.model)} glasses… {found} found
          </Text>
          <ButtonRow>
            <Button label="Stop scan" variant="secondary" onPress={() => void session.stopScan()} />
          </ButtonRow>
        </View>
      ) : (
        <ButtonRow>
          <Button
            label={scan.lastResultCount === null ? 'Scan for glasses' : 'Scan again'}
            disabled={busy !== null}
            onPress={() => void session.startScan()}
          />
        </ButtonRow>
      )}

      {found > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.deviceList}>
          {scan.devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              selected={device.id === selectedId}
              onPress={() => session.selectDevice(device)}
            />
          ))}
        </View>
      ) : null}

      {found > 0 ? (
        <ButtonRow>
          <Button
            label={scan.selected ? `Connect to ${scan.selected.name}` : 'Choose your glasses'}
            busy={busy !== null && busy.startsWith('Connect')}
            disabled={!scan.selected || busy !== null}
            onPress={() => void session.connectSelected()}
          />
        </ButtonRow>
      ) : null}

      {scan.hint ? <Hint>{scan.hint}</Hint> : null}
      {!scan.active && scan.lastResultCount === 0 && !scan.hint ? (
        <Hint>
          No glasses found. Check that they are charged, close by, and in pairing mode, then scan again.
          {Platform.OS === 'android' ? ' Some phones also need Location turned on to find Bluetooth devices.' : ''}
        </Hint>
      ) : null}
      <Hint>
        {Platform.OS === 'android'
          ? 'Companion asks for Nearby devices permission, and Location on some phones, only to find and connect to your glasses.'
          : 'Your iPhone asks once for Bluetooth access. Companion uses it only to find and connect to your glasses.'}
      </Hint>
    </Card>
  );
}

function DeviceRow({ device, selected, onPress }: { device: Device; selected: boolean; onPress: () => void }) {
  const palette = usePalette();
  const details = [
    device.model,
    typeof device.rssi === 'number' ? `${device.rssi} dBm` : null,
    device.pairingMode ? 'pairing mode' : null,
    device.pairingCode ? `code ${device.pairingCode}` : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${device.name}, ${details.join(', ')}`}
      onPress={onPress}
      style={[
        styles.deviceRow,
        { borderColor: selected ? palette.primary : palette.border, backgroundColor: selected ? palette.muted : palette.card },
      ]}>
      <View style={[styles.radio, { borderColor: selected ? palette.primary : palette.mutedForeground }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
      <View style={styles.flex}>
        <Text style={[styles.deviceName, { color: palette.foreground }]}>{device.name}</Text>
        <Text style={[styles.deviceDetail, { color: palette.mutedForeground }]}>{details.join(' · ')}</Text>
      </View>
    </Pressable>
  );
}

function DisplayCard({ session }: { session: CompanionSession }) {
  const palette = usePalette();
  const [text, setText] = useState('');
  const [live, setLive] = useState(false);

  function onChangeText(next: string) {
    setText(next);
    if (live) {
      session.showText(next, false);
    }
  }

  return (
    <Card title="Display">
      <TextInput
        value={text}
        onChangeText={onChangeText}
        placeholder="Text to show on your glasses"
        placeholderTextColor={palette.mutedForeground}
        maxLength={DISPLAY_TEXT_MAX_LENGTH}
        returnKeyType="send"
        onSubmitEditing={() => session.showText(text, true)}
        accessibilityLabel="Text to show on your glasses"
        style={[styles.input, { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background }]}
      />
      <View style={styles.switchRow}>
        <Text style={[styles.body, styles.flex, { color: palette.foreground }]}>Update as I type</Text>
        <Switch
          value={live}
          onValueChange={setLive}
          accessibilityLabel="Update the glasses display as I type"
          trackColor={{ true: palette.primary, false: palette.muted }}
        />
      </View>
      <ButtonRow>
        <Button label="Show" disabled={text.trim().length === 0} onPress={() => session.showText(text, true)} />
        <Button label="Clear display" variant="secondary" onPress={() => void session.clearDisplay()} />
      </ButtonRow>
      <Hint>
        Keep it short: the display is made for a glance. Updates are batched so the glasses only get the latest text.
      </Hint>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: space.xl },
  body: { fontSize: 15, lineHeight: 20 },
  chipRow: { flexDirection: 'row', gap: space.sm },
  scanStatus: { gap: space.sm },
  deviceList: { gap: space.sm },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  deviceName: { fontSize: 16, fontWeight: '600' },
  deviceDetail: { fontSize: 13, marginTop: 2 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
