// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/useBluetoothSdkExample.ts. Modified for Companion; see mobile/README.md#attribution.
import { PermissionsAndroid, Platform, type Permission } from 'react-native';

import {
  ALL_GRANTED,
  bluetoothPermissionPlan,
  evaluatePermissionResults,
  requiredBluetoothPermissions,
  type PermissionVerdict,
} from '../lib/androidPermissions';

function androidApiLevel(): number {
  const version = Platform.Version;
  return typeof version === 'number' ? version : Number.parseInt(String(version), 10) || 0;
}

/**
 * Asks for the Bluetooth permissions at the moment the user starts a scan or a connection,
 * never at launch. iOS has no runtime call here: the system shows its Bluetooth prompt, with
 * the NSBluetoothAlwaysUsageDescription copy, the first time the SDK uses Bluetooth.
 */
export async function requestBluetoothPermissions(): Promise<PermissionVerdict> {
  if (Platform.OS !== 'android') {
    return ALL_GRANTED;
  }
  const apiLevel = androidApiLevel();
  const results = await PermissionsAndroid.requestMultiple(bluetoothPermissionPlan(apiLevel) as Permission[]);
  return evaluatePermissionResults(apiLevel, results);
}

/** Checks without prompting; used to decide whether a reconnect at launch may run. */
export async function hasBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const required = requiredBluetoothPermissions(androidApiLevel()) as Permission[];
  const granted = await Promise.all(required.map((permission) => PermissionsAndroid.check(permission)));
  return granted.every(Boolean);
}
