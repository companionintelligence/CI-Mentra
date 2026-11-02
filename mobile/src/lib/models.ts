// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/useBluetoothSdkExample.ts and src/sdkFormat.ts. Modified for Companion; see mobile/README.md#attribution.
import type { DeviceModel } from '@mentra/bluetooth-sdk';

/**
 * Glasses models the app offers in its scan picker, in display order. Mentra Live is the
 * primary target; Even Realities G2 is the display-equipped model the SDK docs use for the
 * display API. Values are the SDK's own `DeviceModels` strings.
 */
export const SCAN_MODELS = ['Mentra Live', 'Even Realities G2'] as const satisfies readonly DeviceModel[];
export type ScanModel = (typeof SCAN_MODELS)[number];
export const DEFAULT_SCAN_MODEL: ScanModel = 'Mentra Live';

export type ModelCapabilities = {
  /** The glasses can show text sent with `displayText` / `clearDisplay`. */
  display: boolean;
  /** The glasses report their own Wi-Fi and hotspot state. */
  wifi: boolean;
};

const UNVERIFIED: ModelCapabilities = { display: false, wifi: false };

/**
 * What each SDK model is documented to support. Only hardware the Mentra Bluetooth SDK docs
 * describe is marked capable (docs/hardware-integration.md, docs/display-guide.md and the
 * Wi-Fi/hotspot API notes): Mentra Live has Wi-Fi and a hotspot but no display; G2 has a
 * display, and its Wi-Fi is not documented. Every other model is treated as unsupported until
 * it is verified, so the app never offers a command the glasses might reject.
 *
 * Typed as Record<DeviceModel, ...> so `tsc` fails when an SDK update adds a model, forcing
 * an explicit decision here instead of a silent default.
 */
export const MODEL_CAPABILITIES: Readonly<Record<DeviceModel, ModelCapabilities>> = {
  'Mentra Live': { display: false, wifi: true },
  'Even Realities G2': { display: true, wifi: false },
  'Even Realities G1': UNVERIFIED,
  'Even Realities R1': UNVERIFIED,
  'Mentra Display': UNVERIFIED,
  'Mentra Mach1': UNVERIFIED,
  'Vuzix Z100': UNVERIFIED,
  'Brilliant Frame': UNVERIFIED,
  NIMO: UNVERIFIED,
  AR99: UNVERIFIED,
  'Simulated Glasses': UNVERIFIED,
};

export function isKnownModel(value: unknown): value is DeviceModel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MODEL_CAPABILITIES, value);
}

export function capabilitiesFor(model: DeviceModel | null): ModelCapabilities {
  return model ? MODEL_CAPABILITIES[model] : UNVERIFIED;
}

/**
 * Work out which model is connected. The glasses report `deviceModel` once connected; until
 * then (or if they report something unexpected) fall back to the model of the device the
 * user picked, which the SDK typed at scan time. Returns null when neither is known.
 */
export function resolveConnectedModel(
  reportedModel: string | undefined,
  selectedModel: DeviceModel | null | undefined,
): DeviceModel | null {
  if (isKnownModel(reportedModel)) {
    return reportedModel;
  }
  return selectedModel ?? null;
}

export function scanModelLabel(model: ScanModel): string {
  return model === 'Even Realities G2' ? 'Even G2' : 'Mentra Live';
}
