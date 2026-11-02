import {
  ACCESS_FINE_LOCATION,
  BLUETOOTH_CONNECT,
  BLUETOOTH_SCAN,
  bluetoothPermissionPlan,
  describeVerdict,
  evaluatePermissionResults,
  requiredBluetoothPermissions,
} from './androidPermissions';

describe('Android Bluetooth permission plan', () => {
  test('asks only for discovery and connection permissions', () => {
    expect(bluetoothPermissionPlan(28)).toEqual([ACCESS_FINE_LOCATION]);
    expect(bluetoothPermissionPlan(30)).toEqual([ACCESS_FINE_LOCATION]);
    expect(bluetoothPermissionPlan(31)).toEqual([BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION]);
    expect(bluetoothPermissionPlan(35)).toEqual([BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION]);
    for (const apiLevel of [28, 31, 35]) {
      const plan = bluetoothPermissionPlan(apiLevel).join(' ');
      expect(plan).not.toMatch(/CAMERA|RECORD_AUDIO|POST_NOTIFICATIONS|BACKGROUND_LOCATION/);
    }
  });

  test('Nearby devices is required on Android 12+, location before it', () => {
    expect(requiredBluetoothPermissions(31)).toEqual([BLUETOOTH_SCAN, BLUETOOTH_CONNECT]);
    expect(requiredBluetoothPermissions(29)).toEqual([ACCESS_FINE_LOCATION]);
  });
});

describe('evaluatePermissionResults', () => {
  test('all granted', () => {
    const verdict = evaluatePermissionResults(34, {
      [BLUETOOTH_SCAN]: 'granted',
      [BLUETOOTH_CONNECT]: 'granted',
      [ACCESS_FINE_LOCATION]: 'granted',
    });
    expect(verdict).toEqual({ ok: true, denied: [], blocked: [], warning: null });
    expect(describeVerdict(verdict)).toBeNull();
  });

  test('location refused on Android 12+ is a warning, not a blocker', () => {
    const verdict = evaluatePermissionResults(34, {
      [BLUETOOTH_SCAN]: 'granted',
      [BLUETOOTH_CONNECT]: 'granted',
      [ACCESS_FINE_LOCATION]: 'denied',
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.denied).toEqual([ACCESS_FINE_LOCATION]);
    expect(describeVerdict(verdict)).toMatch(/allow Location/);
  });

  test('Nearby devices refused blocks scanning', () => {
    const verdict = evaluatePermissionResults(33, {
      [BLUETOOTH_SCAN]: 'denied',
      [BLUETOOTH_CONNECT]: 'granted',
      [ACCESS_FINE_LOCATION]: 'granted',
    });
    expect(verdict.ok).toBe(false);
    expect(describeVerdict(verdict)).toBe('Companion needs Nearby devices permission to find and connect to your glasses.');
  });

  test('"don\'t ask again" points to Settings', () => {
    const verdict = evaluatePermissionResults(33, {
      [BLUETOOTH_SCAN]: 'never_ask_again',
      [BLUETOOTH_CONNECT]: 'never_ask_again',
      [ACCESS_FINE_LOCATION]: 'never_ask_again',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.blocked).toHaveLength(3);
    expect(describeVerdict(verdict)).toBe(
      'Nearby devices and Location permissions are turned off. Open Settings to allow them, then try again.',
    );
  });

  test('before Android 12, location is required to scan', () => {
    expect(evaluatePermissionResults(30, { [ACCESS_FINE_LOCATION]: 'denied' }).ok).toBe(false);
    expect(evaluatePermissionResults(30, { [ACCESS_FINE_LOCATION]: 'granted' }).ok).toBe(true);
  });
});
