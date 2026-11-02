import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('gives the defaults when nothing usable is stored', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps capture off until the user turns it on', () => {
    expect(DEFAULT_SETTINGS.captureEnabled).toBe(false);
    expect(parseSettings({}).captureEnabled).toBe(false);
  });

  it('reads stored choices and falls back per field when a type is wrong', () => {
    expect(
      parseSettings({
        applianceUrl: 'ci-mentra.example.ts.net',
        captureEnabled: true,
        captureSpeech: false,
        captureInput: 'yes',
        captureDevice: 0,
      }),
    ).toEqual({
      applianceUrl: 'https://ci-mentra.example.ts.net',
      captureEnabled: true,
      captureSpeech: false,
      captureInput: true,
      captureDevice: true,
    });
  });

  it('drops an appliance address that the app would refuse', () => {
    expect(parseSettings({ applianceUrl: 'http://192.168.1.10:8080' }).applianceUrl).toBe('');
    expect(parseSettings({ applianceUrl: 42 }).applianceUrl).toBe('');
  });
});
