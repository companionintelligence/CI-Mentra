import {
  capabilitiesFor,
  DEFAULT_SCAN_MODEL,
  isKnownModel,
  MODEL_CAPABILITIES,
  resolveConnectedModel,
  SCAN_MODELS,
  scanModelLabel,
} from './models';

describe('model capabilities', () => {
  test('scan picker offers documented models, Mentra Live first', () => {
    expect(SCAN_MODELS[0]).toBe('Mentra Live');
    expect(DEFAULT_SCAN_MODEL).toBe('Mentra Live');
    for (const model of SCAN_MODELS) {
      expect(isKnownModel(model)).toBe(true);
    }
    expect(SCAN_MODELS.map(scanModelLabel)).toEqual(['Mentra Live', 'Even G2']);
  });

  test('follows the SDK hardware table: Mentra Live has no display, G2 has one', () => {
    expect(MODEL_CAPABILITIES['Mentra Live']).toEqual({ display: false, wifi: true });
    expect(MODEL_CAPABILITIES['Even Realities G2']).toEqual({ display: true, wifi: false });
  });

  test('every model the docs do not describe gets no capabilities', () => {
    const documented = new Set(['Mentra Live', 'Even Realities G2']);
    const undocumented = Object.entries(MODEL_CAPABILITIES).filter(([model]) => !documented.has(model));
    expect(undocumented.length).toBeGreaterThan(0);
    for (const [, capabilities] of undocumented) {
      expect(capabilities).toEqual({ display: false, wifi: false });
    }
    expect(capabilitiesFor(null)).toEqual({ display: false, wifi: false });
  });

  test('isKnownModel matches exact SDK strings only', () => {
    expect(isKnownModel('Mentra Live')).toBe(true);
    expect(isKnownModel('mentra live')).toBe(false);
    expect(isKnownModel('toString')).toBe(false);
    expect(isKnownModel(undefined)).toBe(false);
    expect(isKnownModel(42)).toBe(false);
  });

  test('resolveConnectedModel prefers what the glasses report, then the picked device', () => {
    expect(resolveConnectedModel('Even Realities G2', 'Mentra Live')).toBe('Even Realities G2');
    expect(resolveConnectedModel('Some Future Glasses', 'Mentra Live')).toBe('Mentra Live');
    expect(resolveConnectedModel(undefined, 'Even Realities G2')).toBe('Even Realities G2');
    expect(resolveConnectedModel(undefined, null)).toBeNull();
    expect(resolveConnectedModel('', undefined)).toBeNull();
  });
});
