// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/sdkFormat.ts. Modified for Companion; see mobile/README.md#attribution.
import type { DeviceModel, GlassesConnectionStatus } from '@mentra/bluetooth-sdk';
import type { GlassesRuntimeState } from '@mentra/bluetooth-sdk/react';

import { capabilitiesFor } from './models';

export type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export type LifecycleView = {
  title: string;
  detail: string;
  tone: Tone;
};

/** Human-readable view of the SDK's typed link-layer state. */
export function lifecycleView(connection: GlassesConnectionStatus): LifecycleView {
  switch (connection.state) {
    case 'disconnected':
      return { title: 'Not connected', detail: 'Scan to find your glasses, or reconnect to saved glasses.', tone: 'neutral' };
    case 'scanning':
      return { title: 'Searching', detail: 'Looking for glasses nearby.', tone: 'progress' };
    case 'connecting':
      return { title: 'Connecting', detail: 'Opening a Bluetooth link to the glasses.', tone: 'progress' };
    case 'bonding':
      return { title: 'Pairing', detail: 'Accept the pairing request if your phone shows one.', tone: 'progress' };
    case 'connected':
      return connection.fullyBooted
        ? { title: 'Ready', detail: 'Connected and fully booted.', tone: 'success' }
        : { title: 'Starting up', detail: 'Connected. Waiting for the glasses to finish booting.', tone: 'progress' };
  }
}

export type DisplayAvailability =
  | { available: true }
  | { available: false; reason: 'not-connected' | 'not-ready' | 'no-display'; message: string };

/**
 * Display commands are offered only when the glasses are connected, fully booted, and the
 * connected model is documented to have a display. An unknown model counts as no display.
 */
export function displayAvailability(glasses: GlassesRuntimeState, model: DeviceModel | null): DisplayAvailability {
  if (!glasses.connected) {
    return { available: false, reason: 'not-connected', message: 'Connect glasses to use the display.' };
  }
  if (!glasses.ready) {
    return { available: false, reason: 'not-ready', message: 'Waiting for the glasses to finish booting.' };
  }
  if (!capabilitiesFor(model).display) {
    return {
      available: false,
      reason: 'no-display',
      message: `${model ?? 'These glasses'} ${model ? 'has' : 'have'} no display the app can use.`,
    };
  }
  return { available: true };
}

/** Wi-Fi and hotspot rows only make sense for models documented to report them. */
export function showsWifiStatus(glasses: GlassesRuntimeState, model: DeviceModel | null): boolean {
  return glasses.connected && capabilitiesFor(model).wifi;
}

export function batteryLabel(glasses: GlassesRuntimeState): string {
  if (!glasses.connected) {
    return 'Not connected';
  }
  if (glasses.battery.level === null) {
    return 'Waiting for glasses';
  }
  const level = Math.max(0, Math.min(100, Math.round(glasses.battery.level)));
  return glasses.battery.charging ? `${level}% · charging` : `${level}%`;
}

const FIRMWARE_PREFIX: Record<string, string> = {
  app: 'Glasses app',
  bes: 'BES',
  mtk: 'MTK',
  left: 'Left',
  right: 'Right',
};

/** Keeps app and OS versions labelled as such, per the SDK's version-field guidance. */
export function firmwareLabel(glasses: GlassesRuntimeState): string {
  if (!glasses.connected || glasses.firmware.version === null) {
    return 'Not reported';
  }
  const prefix = FIRMWARE_PREFIX[glasses.firmware.source];
  return prefix ? `${prefix} ${glasses.firmware.version}` : glasses.firmware.version;
}

export function signalLabel(glasses: GlassesRuntimeState): string {
  const dbm = glasses.connected ? glasses.signal.strengthDbm : null;
  return typeof dbm === 'number' && dbm !== -1 ? `${dbm} dBm` : 'Unknown';
}

export function wifiLabel(glasses: GlassesRuntimeState): string {
  if (!glasses.connected) {
    return 'Not connected';
  }
  return glasses.wifi.state === 'connected' ? `Connected to ${glasses.wifi.ssid}` : 'Not connected';
}

/** Never includes the hotspot password. */
export function hotspotLabel(glasses: GlassesRuntimeState): string {
  if (!glasses.connected) {
    return 'Off';
  }
  return glasses.hotspot.state === 'enabled' ? `On (${glasses.hotspot.ssid})` : 'Off';
}

export function connectedNameLabel(glasses: GlassesRuntimeState, fallback: string | undefined): string {
  if (glasses.connected) {
    return glasses.device.bluetoothName || glasses.device.deviceModel || fallback || 'Glasses';
  }
  return fallback || 'Glasses';
}

/** Fraction of the scan window that has elapsed, clamped to 0..1. */
export function scanProgress(startedAt: number | null, now: number, timeoutMs: number): number {
  if (startedAt === null || timeoutMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, (now - startedAt) / timeoutMs));
}
