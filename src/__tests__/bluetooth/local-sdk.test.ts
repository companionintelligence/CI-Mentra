import { createLocalBluetoothRuntimeInfo, resolveBluetoothVariant } from '../../bluetooth/local-sdk';

describe('local bluetooth sdk helpers', () => {
  it('defaults to Mentra Live when target is omitted', () => {
    expect(resolveBluetoothVariant()).toEqual({
      target: 'mentra-live',
      displayName: 'Mentra Live',
      scanModel: 'MentraLive',
    });
  });

  it('resolves Even Realities target settings', () => {
    expect(resolveBluetoothVariant('even-realities')).toEqual({
      target: 'even-realities',
      displayName: 'Even Realities',
      scanModel: 'EvenRealities',
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
    });
  });
});
