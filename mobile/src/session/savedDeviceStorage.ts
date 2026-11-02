// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/useBluetoothSdkExample.ts. Modified for Companion; see mobile/README.md#attribution.
import type { Device } from '@mentra/bluetooth-sdk';
import type { DefaultDeviceStorage } from '@mentra/bluetooth-sdk/react';
import { File, Paths } from 'expo-file-system';

import { parseSavedDeviceRecord, toSavedDeviceRecord } from '../lib/savedDevice';

const FILE_NAME = 'companion-saved-glasses.json';

function savedDeviceFile(): File {
  return new File(Paths.document, FILE_NAME);
}

/**
 * App-owned record of the last connected glasses. The SDK does not persist a default device
 * across app restarts on its own; `useMentraBluetooth` loads this record at startup and
 * restores it with `setDefaultDevice()` so `connectDefault()` can reconnect.
 */
export const savedDeviceStorage: DefaultDeviceStorage = {
  async load(): Promise<Device | null> {
    const file = savedDeviceFile();
    if (!file.exists) {
      return null;
    }
    try {
      return parseSavedDeviceRecord(JSON.parse(await file.text()));
    } catch {
      // A corrupt record means "no saved glasses"; the next connect rewrites it.
      return null;
    }
  },
  async save(device: Device | null): Promise<void> {
    const file = savedDeviceFile();
    if (!device) {
      if (file.exists) {
        file.delete();
      }
      return;
    }
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(toSavedDeviceRecord(device, Date.now())));
  },
};
