export type BluetoothTarget = 'mentra-live' | 'even-realities';

type BluetoothVariant = {
  target: BluetoothTarget;
  displayName: string;
  scanModel: 'MentraLive' | 'EvenRealities';
};

const MENTRA_LIVE_VARIANT: BluetoothVariant = {
  target: 'mentra-live',
  displayName: 'Mentra Live',
  scanModel: 'MentraLive',
};

const EVEN_REALITIES_VARIANT: BluetoothVariant = {
  target: 'even-realities',
  displayName: 'Even Realities',
  scanModel: 'EvenRealities',
};

export function resolveBluetoothVariant(target?: string): BluetoothVariant {
  if (target === EVEN_REALITIES_VARIANT.target) return EVEN_REALITIES_VARIANT;
  return MENTRA_LIVE_VARIANT;
}

export function createLocalBluetoothRuntimeInfo(
  sdkVersion: string,
  target?: string,
  localPackagePath?: string
): {
  sdkPackage: '@mentra/bluetooth-sdk';
  sdkVersion: string;
  sdkSource: string;
  target: BluetoothTarget;
  displayName: string;
  scanModel: 'MentraLive' | 'EvenRealities';
} {
  const variant = resolveBluetoothVariant(target);
  return {
    sdkPackage: '@mentra/bluetooth-sdk',
    sdkVersion,
    sdkSource: localPackagePath ? `local:${localPackagePath}` : 'npm',
    target: variant.target,
    displayName: variant.displayName,
    scanModel: variant.scanModel,
  };
}
