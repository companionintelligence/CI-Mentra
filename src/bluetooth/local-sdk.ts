export type BluetoothTarget = 'mentra-live' | 'even-realities' | 'g2' | 'vuzix-z100' | 'nimo';

type BluetoothVariant = {
  target: BluetoothTarget;
  displayName: string;
  scanModel: string;
  ftue: string[];
};

const MENTRA_LIVE_VARIANT: BluetoothVariant = {
  target: 'mentra-live',
  displayName: 'Mentra Live',
  scanModel: 'MentraLive',
  ftue: [
    'Scan for Mentra Live and show discovered devices as they appear.',
    'Connect to the selected device and verify camera/microphone capabilities before enabling media actions.',
  ],
};

const EVEN_REALITIES_VARIANT: BluetoothVariant = {
  target: 'even-realities',
  displayName: 'Even Realities',
  scanModel: 'EvenRealities',
  ftue: [
    'Scan for Even Realities devices and let the user choose the expected headset.',
    'After connect, prioritize display-first onboarding cards and gate unsupported camera/audio controls.',
  ],
};

const G2_VARIANT: BluetoothVariant = {
  target: 'g2',
  displayName: 'Mentra G2',
  scanModel: 'G2',
  ftue: [
    'Scan for G2 devices and open with text/dashboard examples after connection.',
    'Focus FTUE on glanceable display controls before enabling optional voice features.',
  ],
};

const VUZIX_Z100_VARIANT: BluetoothVariant = {
  target: 'vuzix-z100',
  displayName: 'Vuzix Z100',
  scanModel: 'VuzixZ100',
  ftue: [
    'Scan for Vuzix Z100 and confirm pairing on both phone and glasses prompts.',
    'Show a short dashboard/text smoke test and then continue to optional integrations.',
  ],
};

const NIMO_VARIANT: BluetoothVariant = {
  target: 'nimo',
  displayName: 'NIMO',
  scanModel: 'Nimo',
  ftue: [
    'Scan for NIMO and keep reconnect/forget controls visible during first-time setup.',
    'Use capability-gated actions so unsupported media/network features fail gracefully.',
  ],
};

const BLUETOOTH_VARIANTS: BluetoothVariant[] = [
  MENTRA_LIVE_VARIANT,
  EVEN_REALITIES_VARIANT,
  G2_VARIANT,
  VUZIX_Z100_VARIANT,
  NIMO_VARIANT,
];

export function listBluetoothTargets(): BluetoothTarget[] {
  return BLUETOOTH_VARIANTS.map((variant) => variant.target);
}

export function resolveBluetoothVariant(target?: string): BluetoothVariant {
  if (!target) return MENTRA_LIVE_VARIANT;
  return BLUETOOTH_VARIANTS.find((variant) => variant.target === target) || MENTRA_LIVE_VARIANT;
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
  scanModel: string;
  supportedTargets: BluetoothTarget[];
  ftue: {
    firstTimeFlow: string[];
    capabilityGuidance: string;
  };
} {
  const variant = resolveBluetoothVariant(target);
  return {
    sdkPackage: '@mentra/bluetooth-sdk',
    sdkVersion,
    sdkSource: localPackagePath ? `local:${localPackagePath}` : 'npm',
    target: variant.target,
    displayName: variant.displayName,
    scanModel: variant.scanModel,
    supportedTargets: listBluetoothTargets(),
    ftue: {
      firstTimeFlow: variant.ftue,
      capabilityGuidance: 'Use runtime capability state to gate advanced controls and avoid unsupported actions.',
    },
  };
}
