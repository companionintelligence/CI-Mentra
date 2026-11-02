// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/useBluetoothSdkExample.ts. Modified for Companion; see mobile/README.md#attribution.
import type { Device } from '@mentra/bluetooth-sdk';

import { isKnownModel } from './models';

/**
 * On-disk record for the glasses the user last connected to, so `connectDefault()` works after
 * an app restart. Only the fields the SDK needs to reconnect are kept: no RSSI, and no pairing
 * code, which is short-lived and should not be written to disk.
 */
export type SavedDeviceRecord = {
  version: 1;
  savedAt: number;
  device: Pick<Device, 'id' | 'model' | 'name' | 'address'>;
};

export function toSavedDeviceRecord(device: Device, now: number): SavedDeviceRecord {
  return {
    version: 1,
    savedAt: now,
    device: {
      id: device.id,
      model: device.model,
      name: device.name,
      ...(device.address ? { address: device.address } : {}),
    },
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Parses a stored record defensively. Anything malformed, from a future version, or naming a
 * model this SDK build does not know is treated as "no saved device" rather than an error.
 */
export function parseSavedDeviceRecord(value: unknown): Device | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !record.device || typeof record.device !== 'object') {
    return null;
  }
  const device = record.device as Record<string, unknown>;
  const model = device.model;
  const name = nonEmptyString(device.name);
  if (!isKnownModel(model) || !name) {
    return null;
  }
  const address = nonEmptyString(device.address);
  return {
    id: nonEmptyString(device.id) ?? address ?? `${model}:${name}`,
    model,
    name,
    ...(address ? { address } : {}),
  };
}
