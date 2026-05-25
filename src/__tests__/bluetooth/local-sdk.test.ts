import { createLocalBluetoothRuntimeInfo, listBluetoothTargets, resolveBluetoothVariant } from '../../bluetooth/local-sdk';

describe('local bluetooth sdk helpers', () => {
  it('defaults to Mentra Live when target is omitted', () => {
    expect(resolveBluetoothVariant()).toEqual({
      target: 'mentra-live',
      displayName: 'Mentra Live',
      scanModel: 'MentraLive',
      ftue: [
        'Scan for Mentra Live and show discovered devices as they appear.',
        'Connect to the selected device and verify camera/microphone capabilities before enabling media actions.',
      ],
    });
  });

  it('resolves Even Realities target settings', () => {
    expect(resolveBluetoothVariant('even-realities')).toEqual({
      target: 'even-realities',
      displayName: 'Even Realities',
      scanModel: 'EvenRealities',
      ftue: [
        'Scan for Even Realities devices and let the user choose the expected headset.',
        'After connect, prioritize display-first onboarding cards and gate unsupported camera/audio controls.',
      ],
    });
  });

  it('supports additional headset variants', () => {
    expect(listBluetoothTargets()).toEqual(['mentra-live', 'even-realities', 'g2', 'vuzix-z100', 'nimo']);

    expect(resolveBluetoothVariant('g2')).toEqual({
      target: 'g2',
      displayName: 'Mentra G2',
      scanModel: 'G2',
      ftue: [
        'Scan for G2 devices and open with text/dashboard examples after connection.',
        'Focus FTUE on glanceable display controls before enabling optional voice features.',
      ],
    });
  });

  it('marks runtime info as local when sdk path is provided', () => {
    expect(
      createLocalBluetoothRuntimeInfo('0.1.6', 'even-realities', '/Users/dev/MentraOS/mobile/modules/bluetooth-sdk')
    ).toEqual({
      sdkPackage: '@mentra/bluetooth-sdk',
      sdkVersion: '0.1.6',
      sdkSource: 'local:/Users/dev/MentraOS/mobile/modules/bluetooth-sdk',
      target: 'even-realities',
      displayName: 'Even Realities',
      scanModel: 'EvenRealities',
      supportedTargets: ['mentra-live', 'even-realities', 'g2', 'vuzix-z100', 'nimo'],
      ftue: {
        firstTimeFlow: [
          'Scan for Even Realities devices and let the user choose the expected headset.',
          'After connect, prioritize display-first onboarding cards and gate unsupported camera/audio controls.',
        ],
        capabilityGuidance: 'Use runtime capability state to gate advanced controls and avoid unsupported actions.',
      },
    });
  });
});
