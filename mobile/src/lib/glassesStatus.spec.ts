import type { GlassesRuntimeState } from '@mentra/bluetooth-sdk/react';

import {
  batteryLabel,
  connectedNameLabel,
  displayAvailability,
  firmwareLabel,
  hotspotLabel,
  lifecycleView,
  scanProgress,
  showsWifiStatus,
  signalLabel,
  wifiLabel,
} from './glassesStatus';

type ConnectedState = Extract<GlassesRuntimeState, { connected: true }>;

const disconnected: GlassesRuntimeState = { connected: false, connection: { state: 'disconnected' }, ready: false };

function connected(overrides: Partial<ConnectedState> = {}): ConnectedState {
  const fullyBooted = overrides.ready ?? true;
  return {
    connected: true,
    connection: { state: 'connected', fullyBooted },
    ready: fullyBooted,
    battery: { level: 80, charging: false },
    device: { deviceModel: 'Mentra Live', bluetoothName: 'Mentra Live 1A2B' },
    firmware: { source: 'firmware', version: '1.4.0' },
    hotspot: { state: 'disabled' },
    signal: { strengthDbm: -58, updatedAt: 1 },
    voiceActivityDetectionEnabled: false,
    wifi: { state: 'disconnected' },
    ...overrides,
  };
}

describe('lifecycleView', () => {
  test('names every typed connection state', () => {
    expect(lifecycleView({ state: 'disconnected' }).title).toBe('Not connected');
    expect(lifecycleView({ state: 'scanning' }).title).toBe('Searching');
    expect(lifecycleView({ state: 'connecting' }).title).toBe('Connecting');
    expect(lifecycleView({ state: 'bonding' }).title).toBe('Pairing');
  });

  test('separates connected-but-booting from fully booted', () => {
    expect(lifecycleView({ state: 'connected', fullyBooted: false })).toMatchObject({ title: 'Starting up', tone: 'progress' });
    expect(lifecycleView({ state: 'connected', fullyBooted: true })).toMatchObject({ title: 'Ready', tone: 'success' });
  });
});

describe('displayAvailability', () => {
  test('requires a connection, a finished boot and a display-equipped model', () => {
    expect(displayAvailability(disconnected, 'Even Realities G2')).toMatchObject({ available: false, reason: 'not-connected' });
    expect(displayAvailability(connected({ ready: false }), 'Even Realities G2')).toMatchObject({ available: false, reason: 'not-ready' });
    expect(displayAvailability(connected(), 'Mentra Live')).toMatchObject({
      available: false,
      reason: 'no-display',
      message: 'Mentra Live has no display the app can use.',
    });
    expect(displayAvailability(connected(), 'Vuzix Z100')).toMatchObject({ available: false, reason: 'no-display' });
    expect(displayAvailability(connected(), null)).toMatchObject({ available: false, reason: 'no-display' });
    expect(displayAvailability(connected(), 'Even Realities G2')).toEqual({ available: true });
  });
});

describe('status labels', () => {
  test('battery is clamped, rounded and marks charging', () => {
    expect(batteryLabel(disconnected)).toBe('Not connected');
    expect(batteryLabel(connected({ battery: { level: null, charging: false } }))).toBe('Waiting for glasses');
    expect(batteryLabel(connected({ battery: { level: 104, charging: false } }))).toBe('100%');
    expect(batteryLabel(connected({ battery: { level: 41.6, charging: true } }))).toBe('42% · charging');
  });

  test('firmware keeps app versions labelled as app versions', () => {
    expect(firmwareLabel(connected())).toBe('1.4.0');
    expect(firmwareLabel(connected({ firmware: { source: 'app', version: '2.0.1' } }))).toBe('Glasses app 2.0.1');
    expect(firmwareLabel(connected({ firmware: { source: 'bes', version: '17' } }))).toBe('BES 17');
    expect(firmwareLabel(connected({ firmware: { source: 'unknown', version: null } }))).toBe('Not reported');
    expect(firmwareLabel(disconnected)).toBe('Not reported');
  });

  test('signal ignores the -1 placeholder', () => {
    expect(signalLabel(connected())).toBe('-58 dBm');
    expect(signalLabel(connected({ signal: { strengthDbm: -1, updatedAt: null } }))).toBe('Unknown');
    expect(signalLabel(disconnected)).toBe('Unknown');
  });

  test('Wi-Fi and hotspot labels never expose the hotspot password', () => {
    const glasses = connected({
      wifi: { state: 'connected', ssid: 'Studio' },
      hotspot: { state: 'enabled', ssid: 'MentraLive-1A2B', password: 'secret-pass', localIp: '192.168.43.1' },
    });
    expect(wifiLabel(glasses)).toBe('Connected to Studio');
    expect(hotspotLabel(glasses)).toBe('On (MentraLive-1A2B)');
    expect(hotspotLabel(glasses)).not.toContain('secret-pass');
    expect(wifiLabel(connected())).toBe('Not connected');
    expect(hotspotLabel(disconnected)).toBe('Off');
    expect(wifiLabel(disconnected)).toBe('Not connected');
    expect(hotspotLabel(connected())).toBe('Off');
  });

  test('Wi-Fi rows show only for models documented to report Wi-Fi', () => {
    expect(showsWifiStatus(connected(), 'Mentra Live')).toBe(true);
    expect(showsWifiStatus(connected(), 'Even Realities G2')).toBe(false);
    expect(showsWifiStatus(connected(), null)).toBe(false);
    expect(showsWifiStatus(disconnected, 'Mentra Live')).toBe(false);
  });

  test('connected name falls back sensibly', () => {
    expect(connectedNameLabel(connected(), 'Saved')).toBe('Mentra Live 1A2B');
    expect(connectedNameLabel(connected({ device: {} }), 'Saved')).toBe('Saved');
    expect(connectedNameLabel(connected({ device: {} }), undefined)).toBe('Glasses');
    expect(connectedNameLabel(disconnected, undefined)).toBe('Glasses');
  });
});

describe('scanProgress', () => {
  test('is a clamped fraction of the scan window', () => {
    expect(scanProgress(null, 5_000, 15_000)).toBe(0);
    expect(scanProgress(1_000, 8_500, 15_000)).toBe(0.5);
    expect(scanProgress(1_000, 99_000, 15_000)).toBe(1);
    expect(scanProgress(5_000, 1_000, 15_000)).toBe(0);
    expect(scanProgress(0, 1_000, 0)).toBe(0);
  });
});
