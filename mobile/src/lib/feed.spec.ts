import type { TouchEvent, TouchGesture } from '@mentra/bluetooth-sdk';

import {
  describeButtonPress,
  describeHeadUp,
  describeTouch,
  filterLog,
  formatClock,
  formatError,
  humanizeGesture,
  prependCapped,
  type LogEntry,
} from './feed';

describe('input event descriptions', () => {
  test('button presses carry the press type and button id', () => {
    expect(describeButtonPress({ buttonId: 'camera', pressType: 'short', timestamp: 1 })).toEqual({
      kind: 'button',
      title: 'Short press',
      detail: 'Button: camera',
    });
    expect(describeButtonPress({ buttonId: '', pressType: 'long', timestamp: 1 }).title).toBe('Long press');
  });

  test('splits the touch stream into taps and swipes', () => {
    const gestures: Record<TouchGesture, 'touch' | 'swipe'> = {
      single_tap: 'touch',
      double_tap: 'touch',
      triple_tap: 'touch',
      long_press: 'touch',
      forward_swipe: 'swipe',
      backward_swipe: 'swipe',
      up_swipe: 'swipe',
      down_swipe: 'swipe',
    };
    for (const [gestureName, kind] of Object.entries(gestures)) {
      const description = describeTouch({ type: 'touch_event', deviceModel: 'Mentra Live', gestureName, timestamp: 1 });
      expect(description.kind).toBe(kind);
    }
    expect(describeTouch({ type: 'touch_event', deviceModel: 'Mentra Live', gestureName: 'forward_swipe', timestamp: 1 })).toEqual({
      kind: 'swipe',
      title: 'Forward swipe',
      detail: 'Touchpad · Mentra Live',
    });
  });

  test('a touch event with no gesture name reads as an unknown tap', () => {
    expect(describeTouch({ type: 'touch_event', deviceModel: 'Mentra Live', gestureName: '', timestamp: 1 })).toEqual({
      kind: 'touch',
      title: 'Unknown gesture',
      detail: 'Touchpad · Mentra Live',
    });
  });

  test('a touch event without a device model describes only the touchpad', () => {
    // The SDK types deviceModel as required; describeTouch still guards against events without it.
    const event = { type: 'touch_event', gestureName: 'single_tap', timestamp: 1 } as unknown as TouchEvent;
    expect(describeTouch(event)).toEqual({ kind: 'touch', title: 'Single tap', detail: 'Touchpad' });
  });

  test('head position', () => {
    expect(describeHeadUp({ up: true }).title).toBe('Head up');
    expect(describeHeadUp({ up: false }).title).toBe('Head down');
  });

  test('humanizeGesture tolerates odd input', () => {
    expect(humanizeGesture('double_tap')).toBe('Double tap');
    expect(humanizeGesture('  UP-SWIPE ')).toBe('Up swipe');
    expect(humanizeGesture('')).toBe('Unknown gesture');
  });
});

describe('feed helpers', () => {
  test('prependCapped keeps the newest items first', () => {
    expect(prependCapped([2, 1], 3, 5)).toEqual([3, 2, 1]);
    expect(prependCapped([3, 2, 1], 4, 3)).toEqual([4, 3, 2]);
    expect(prependCapped([1], 2, 0)).toEqual([]);
  });

  test('filterLog by source', () => {
    const entries: LogEntry[] = [
      { id: 3, at: 3, source: 'error', message: 'c' },
      { id: 2, at: 2, source: 'sdk', message: 'b' },
      { id: 1, at: 1, source: 'app', message: 'a' },
    ];
    expect(filterLog(entries, 'all')).toBe(entries);
    expect(filterLog(entries, 'sdk').map((entry) => entry.id)).toEqual([2]);
    expect(filterLog(entries, 'error').map((entry) => entry.id)).toEqual([3]);
  });

  test('formatClock is zero-padded local time', () => {
    expect(formatClock(new Date(2026, 10, 1, 9, 5, 7).getTime())).toBe('09:05:07');
  });

  test('formatError', () => {
    expect(formatError(new Error('Bluetooth is off'))).toBe('Bluetooth is off');
    expect(formatError('timeout')).toBe('timeout');
    expect(formatError({})).toBe('Unknown error');
  });
});
