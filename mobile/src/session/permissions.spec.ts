import { PermissionsAndroid, Platform } from 'react-native';

import { ACCESS_FINE_LOCATION, ALL_GRANTED, BLUETOOTH_CONNECT, BLUETOOTH_SCAN } from '../lib/androidPermissions';
import { hasBluetoothPermissions, requestBluetoothPermissions } from './permissions';

// react-native is replaced by plain objects so the Node test environment never loads it.
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0' },
  PermissionsAndroid: {
    check: jest.fn(),
    requestMultiple: jest.fn(),
  },
}));

const platform = Platform as unknown as { OS: string; Version: number | string };
const requestMultiple = PermissionsAndroid.requestMultiple as jest.Mock;
const check = PermissionsAndroid.check as jest.Mock;

function setPlatform(os: string, version: number | string): void {
  platform.OS = os;
  platform.Version = version;
}

/** Makes PermissionsAndroid.check report only these permissions as granted. */
function grantOnly(...granted: string[]): void {
  check.mockImplementation((permission: string) => Promise.resolve(granted.includes(permission)));
}

beforeEach(() => {
  requestMultiple.mockReset();
  check.mockReset();
  setPlatform('ios', '17.0');
});

describe('on iOS', () => {
  test('requestBluetoothPermissions resolves to ALL_GRANTED without asking Android', async () => {
    setPlatform('ios', '17.4');
    await expect(requestBluetoothPermissions()).resolves.toEqual(ALL_GRANTED);
    expect(requestMultiple).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  test('hasBluetoothPermissions resolves true without checking any permission', async () => {
    setPlatform('ios', '17.4');
    await expect(hasBluetoothPermissions()).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('requestBluetoothPermissions on Android 12 and later', () => {
  test('asks for Nearby devices and location, then evaluates the answers', async () => {
    setPlatform('android', 34);
    requestMultiple.mockResolvedValue({
      [BLUETOOTH_SCAN]: 'granted',
      [BLUETOOTH_CONNECT]: 'granted',
      [ACCESS_FINE_LOCATION]: 'granted',
    });

    await expect(requestBluetoothPermissions()).resolves.toEqual({ ok: true, denied: [], blocked: [], warning: null });
    expect(requestMultiple).toHaveBeenCalledWith([BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION]);
  });

  test('a refused Nearby devices permission blocks, and "don\'t ask again" is reported as blocked', async () => {
    setPlatform('android', 34);
    requestMultiple.mockResolvedValue({
      [BLUETOOTH_SCAN]: 'never_ask_again',
      [BLUETOOTH_CONNECT]: 'granted',
      [ACCESS_FINE_LOCATION]: 'granted',
    });

    await expect(requestBluetoothPermissions()).resolves.toEqual({
      ok: false,
      denied: [BLUETOOTH_SCAN],
      blocked: [BLUETOOTH_SCAN],
      warning: null,
    });
  });

  test('refused location is a warning, not a blocker', async () => {
    setPlatform('android', 34);
    requestMultiple.mockResolvedValue({
      [BLUETOOTH_SCAN]: 'granted',
      [BLUETOOTH_CONNECT]: 'granted',
      [ACCESS_FINE_LOCATION]: 'denied',
    });

    await expect(requestBluetoothPermissions()).resolves.toEqual({
      ok: true,
      denied: [ACCESS_FINE_LOCATION],
      blocked: [],
      warning: expect.stringContaining('allow Location'),
    });
  });
});

describe('requestBluetoothPermissions before Android 12', () => {
  test.each([28, 30])('on API %i asks only for location', async (apiLevel) => {
    setPlatform('android', apiLevel);
    requestMultiple.mockResolvedValue({ [ACCESS_FINE_LOCATION]: 'granted' });

    await expect(requestBluetoothPermissions()).resolves.toEqual({ ok: true, denied: [], blocked: [], warning: null });
    expect(requestMultiple).toHaveBeenCalledWith([ACCESS_FINE_LOCATION]);
  });

  test('a refused location blocks scanning', async () => {
    setPlatform('android', 30);
    requestMultiple.mockResolvedValue({ [ACCESS_FINE_LOCATION]: 'denied' });

    await expect(requestBluetoothPermissions()).resolves.toMatchObject({ ok: false, denied: [ACCESS_FINE_LOCATION] });
  });
});

describe('Platform.Version as a string', () => {
  test('a string API level of 31 gets the Android 12 plan', async () => {
    setPlatform('android', '31');
    requestMultiple.mockResolvedValue({
      [BLUETOOTH_SCAN]: 'granted',
      [BLUETOOTH_CONNECT]: 'granted',
      [ACCESS_FINE_LOCATION]: 'granted',
    });

    await expect(requestBluetoothPermissions()).resolves.toMatchObject({ ok: true });
    expect(requestMultiple).toHaveBeenCalledWith([BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION]);
  });

  test('an unreadable version falls back to API 0, which gets the location-only plan', async () => {
    setPlatform('android', 'unknown');
    requestMultiple.mockResolvedValue({ [ACCESS_FINE_LOCATION]: 'granted' });

    await expect(requestBluetoothPermissions()).resolves.toMatchObject({ ok: true });
    expect(requestMultiple).toHaveBeenCalledWith([ACCESS_FINE_LOCATION]);
  });
});

describe('hasBluetoothPermissions on Android 12 and later', () => {
  test('is true when both Nearby devices permissions are granted, without checking location', async () => {
    setPlatform('android', 34);
    grantOnly(BLUETOOTH_SCAN, BLUETOOTH_CONNECT);

    await expect(hasBluetoothPermissions()).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledWith(BLUETOOTH_SCAN);
    expect(check).toHaveBeenCalledWith(BLUETOOTH_CONNECT);
  });

  test('is false when scanning is not granted', async () => {
    setPlatform('android', 34);
    grantOnly(BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION);

    await expect(hasBluetoothPermissions()).resolves.toBe(false);
  });

  test('is false when connecting is not granted', async () => {
    setPlatform('android', 34);
    grantOnly(BLUETOOTH_SCAN, ACCESS_FINE_LOCATION);

    await expect(hasBluetoothPermissions()).resolves.toBe(false);
  });

  test('reads a string API level the same way', async () => {
    setPlatform('android', '34');
    grantOnly(BLUETOOTH_SCAN, BLUETOOTH_CONNECT);

    await expect(hasBluetoothPermissions()).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledWith(BLUETOOTH_SCAN);
    expect(check).toHaveBeenCalledWith(BLUETOOTH_CONNECT);
  });
});

describe('hasBluetoothPermissions before Android 12', () => {
  test('is true only when location is granted', async () => {
    setPlatform('android', 30);
    grantOnly(ACCESS_FINE_LOCATION);

    await expect(hasBluetoothPermissions()).resolves.toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(ACCESS_FINE_LOCATION);
  });

  test('is false when location is refused, even if Nearby devices is granted', async () => {
    setPlatform('android', 30);
    grantOnly(BLUETOOTH_SCAN, BLUETOOTH_CONNECT);

    await expect(hasBluetoothPermissions()).resolves.toBe(false);
  });
});
