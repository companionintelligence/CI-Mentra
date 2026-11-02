import type { Device } from '@mentra/bluetooth-sdk';

import { parseSavedDeviceRecord, toSavedDeviceRecord } from './savedDevice';

const scanned: Device = {
  id: 'AA:BB:CC:DD:EE:FF',
  model: 'Mentra Live',
  name: 'Mentra Live 1A2B',
  address: 'AA:BB:CC:DD:EE:FF',
  rssi: -61,
  pairingMode: true,
  pairingCode: 'F00D',
};

describe('saved glasses record', () => {
  test('keeps only what reconnecting needs', () => {
    const record = toSavedDeviceRecord(scanned, 1_700_000_000_000);
    expect(record).toEqual({
      version: 1,
      savedAt: 1_700_000_000_000,
      device: { id: 'AA:BB:CC:DD:EE:FF', model: 'Mentra Live', name: 'Mentra Live 1A2B', address: 'AA:BB:CC:DD:EE:FF' },
    });
    expect(JSON.stringify(record)).not.toContain('F00D');
  });

  test('round-trips through JSON', () => {
    const restored = parseSavedDeviceRecord(JSON.parse(JSON.stringify(toSavedDeviceRecord(scanned, 1))));
    expect(restored).toEqual({ id: scanned.id, model: scanned.model, name: scanned.name, address: scanned.address });
  });

  test('omits a missing address and falls back for a missing id', () => {
    const iosDevice: Device = { id: 'ios-uuid', model: 'Even Realities G2', name: 'Even G2' };
    expect(toSavedDeviceRecord(iosDevice, 1).device).toEqual({ id: 'ios-uuid', model: 'Even Realities G2', name: 'Even G2' });
    expect(parseSavedDeviceRecord({ version: 1, savedAt: 1, device: { model: 'Mentra Live', name: 'Live', address: 'AA' } })?.id).toBe('AA');
    expect(parseSavedDeviceRecord({ version: 1, savedAt: 1, device: { model: 'Mentra Live', name: 'Live' } })?.id).toBe('Mentra Live:Live');
  });

  test('treats anything malformed as no saved glasses', () => {
    expect(parseSavedDeviceRecord(null)).toBeNull();
    expect(parseSavedDeviceRecord('Mentra Live')).toBeNull();
    expect(parseSavedDeviceRecord({ version: 2, device: { model: 'Mentra Live', name: 'Live' } })).toBeNull();
    expect(parseSavedDeviceRecord({ version: 1, device: { model: 'Unknown Glasses', name: 'X' } })).toBeNull();
    expect(parseSavedDeviceRecord({ version: 1, device: { model: 'Mentra Live', name: '   ' } })).toBeNull();
    expect(parseSavedDeviceRecord({ version: 1 })).toBeNull();
  });
});
