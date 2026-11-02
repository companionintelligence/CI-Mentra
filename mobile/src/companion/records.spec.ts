import {
  batteryRecord,
  buttonRecord,
  glassText,
  GLASS_TEXT_LIMIT,
  headRecord,
  recordId,
  speechRecord,
  statusRecord,
  Throttle,
  touchRecord,
  CAPTURE_TEXT_LIMIT,
} from './records';

const NOW = Date.UTC(2026, 10, 2, 9, 15, 0);

describe('recordId', () => {
  it('differs within the same millisecond and matches the appliance id rule', () => {
    const first = recordId(NOW, 1);
    const second = recordId(NOW, 2);

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
  });
});

describe('speechRecord', () => {
  it('stores a final transcript as speech, with whitespace tidied', () => {
    expect(speechRecord({ text: '  remind   me to call Sam ', isFinal: true }, NOW, 1)).toMatchObject({
      kind: 'speech',
      text: 'remind me to call Sam',
      at: '2026-11-02T09:15:00.000Z',
    });
  });

  it('skips partial results and empty text', () => {
    expect(speechRecord({ text: 'remind me', isFinal: false }, NOW, 1)).toBeNull();
    expect(speechRecord({ text: 'remind me' }, NOW, 1)).toBeNull();
    expect(speechRecord({ text: '   ', isFinal: true }, NOW, 1)).toBeNull();
  });

  it('caps very long transcripts at the appliance limit', () => {
    const record = speechRecord({ text: 'a'.repeat(CAPTURE_TEXT_LIMIT + 50), isFinal: true }, NOW, 1);

    expect(record?.text).toHaveLength(CAPTURE_TEXT_LIMIT);
  });
});

describe('input records', () => {
  it('describe a button press with the SDK time', () => {
    expect(buttonRecord({ buttonId: 'main', pressType: 'short', timestamp: NOW }, NOW + 5, 1)).toEqual({
      id: recordId(NOW + 5, 1),
      kind: 'input',
      at: '2026-11-02T09:15:00.000Z',
      text: 'Glasses button main: short press.',
    });
  });

  it('describe a touch gesture in plain words', () => {
    expect(touchRecord({ gestureName: 'forward_swipe', timestamp: NOW }, NOW, 1).text).toBe(
      'Glasses touch: Forward swipe.',
    );
  });

  it('describe head movement', () => {
    expect(headRecord(true, NOW, 1).text).toBe('Glasses head raised.');
    expect(headRecord(false, NOW, 2).text).toBe('Glasses head lowered.');
  });

  it('fall back to the phone clock when the SDK time is missing', () => {
    expect(buttonRecord({ buttonId: '', pressType: 'long', timestamp: 0 }, NOW, 1)).toMatchObject({
      at: '2026-11-02T09:15:00.000Z',
      text: 'Glasses button main: long press.',
    });
  });
});

describe('device records', () => {
  it('report battery, clamped and with the charging state', () => {
    expect(batteryRecord({ level: 61.6, charging: true, timestamp: NOW }, NOW, 1).text).toBe(
      'Glasses battery 62%, charging.',
    );
    expect(batteryRecord({ level: 140, charging: false, timestamp: NOW }, NOW, 2).text).toBe('Glasses battery 100%.');
  });

  it('carry a status line as a device record', () => {
    expect(statusRecord('  Connected to Mentra Live.  ', NOW, 1)).toMatchObject({
      kind: 'device',
      text: 'Connected to Mentra Live.',
    });
  });
});

describe('Throttle', () => {
  it('lets one event through per interval', () => {
    const throttle = new Throttle(1000);

    expect(throttle.allow(0)).toBe(true);
    expect(throttle.allow(999)).toBe(false);
    expect(throttle.allow(1000)).toBe(true);
  });
});

describe('glassText', () => {
  it('leaves short text alone and tidies whitespace', () => {
    expect(glassText('  Four   pm.  ')).toBe('Four pm.');
  });

  it('cuts long text at a word and marks the cut', () => {
    const long = 'word '.repeat(200);
    const cut = glassText(long);

    expect(cut.length).toBeLessThanOrEqual(GLASS_TEXT_LIMIT);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/wor…$/);
  });
});
