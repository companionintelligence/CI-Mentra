// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/useBluetoothSdkExample.ts. Modified for Companion; see mobile/README.md#attribution.
/** Android 12 (API 31) introduced the "Nearby devices" Bluetooth permissions. */
export const ANDROID_12_API_LEVEL = 31;

export const BLUETOOTH_SCAN = 'android.permission.BLUETOOTH_SCAN';
export const BLUETOOTH_CONNECT = 'android.permission.BLUETOOTH_CONNECT';
export const ACCESS_FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION';

export type BluetoothPermission = typeof BLUETOOTH_SCAN | typeof BLUETOOTH_CONNECT | typeof ACCESS_FINE_LOCATION;
export type PermissionResult = 'granted' | 'denied' | 'never_ask_again';

/**
 * Runtime permissions needed to find and connect to glasses. Nothing else is requested: no
 * camera, microphone, notification or background-location prompt in this version.
 *
 * Android 12+ needs the Nearby devices pair. Location is requested too because the SDK docs
 * note that some Android 12+ phones deliver no BLE scan results without it. Before Android 12,
 * BLE scanning requires location.
 */
export function bluetoothPermissionPlan(apiLevel: number): BluetoothPermission[] {
  return apiLevel >= ANDROID_12_API_LEVEL
    ? [BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION]
    : [ACCESS_FINE_LOCATION];
}

/** The subset that must be granted before scanning or connecting is attempted. */
export function requiredBluetoothPermissions(apiLevel: number): BluetoothPermission[] {
  return apiLevel >= ANDROID_12_API_LEVEL ? [BLUETOOTH_SCAN, BLUETOOTH_CONNECT] : [ACCESS_FINE_LOCATION];
}

export type PermissionVerdict = {
  /** Scanning and connecting can go ahead. */
  ok: boolean;
  /** Permissions the user did not grant. */
  denied: BluetoothPermission[];
  /** Refused with "Don't ask again": only the system Settings screen can grant these now. */
  blocked: BluetoothPermission[];
  /** Non-fatal advice to show next to the scan button. */
  warning: string | null;
};

export const ALL_GRANTED: PermissionVerdict = { ok: true, denied: [], blocked: [], warning: null };

export function evaluatePermissionResults(
  apiLevel: number,
  results: Partial<Record<string, PermissionResult>>,
): PermissionVerdict {
  const denied = bluetoothPermissionPlan(apiLevel).filter((permission) => results[permission] !== 'granted');
  const blocked = denied.filter((permission) => results[permission] === 'never_ask_again');
  const ok = requiredBluetoothPermissions(apiLevel).every((permission) => results[permission] === 'granted');
  const warning =
    ok && denied.includes(ACCESS_FINE_LOCATION)
      ? 'Location is not allowed. If no glasses appear, allow Location for Companion: some phones need it for Bluetooth scanning.'
      : null;
  return { ok, denied, blocked, warning };
}

export function permissionLabel(permission: BluetoothPermission): string {
  return permission === ACCESS_FINE_LOCATION ? 'Location' : 'Nearby devices';
}

/** Short, user-facing explanation of a refusal. */
export function describeVerdict(verdict: PermissionVerdict): string | null {
  if (verdict.ok) {
    return verdict.warning;
  }
  const labels = [...new Set(verdict.denied.map(permissionLabel))];
  const names = labels.join(' and ');
  const plural = labels.length > 1;
  return verdict.blocked.length > 0
    ? `${names} ${plural ? 'permissions are' : 'permission is'} turned off. Open Settings to allow ${plural ? 'them' : 'it'}, then try again.`
    : `Companion needs ${names} ${plural ? 'permissions' : 'permission'} to find and connect to your glasses.`;
}
