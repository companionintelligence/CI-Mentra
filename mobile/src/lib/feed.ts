// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/useBluetoothSdkExample.ts. Modified for Companion; see mobile/README.md#attribution.
import type { ButtonPressEvent, HeadUpEvent, TouchEvent } from '@mentra/bluetooth-sdk';

export type InputKind = 'button' | 'touch' | 'swipe' | 'head';

export type InputDescription = {
  kind: InputKind;
  title: string;
  detail: string;
};

export type InputFeedItem = InputDescription & {
  id: number;
  at: number;
};

export type LogSource = 'sdk' | 'app' | 'error';

export type LogEntry = {
  id: number;
  at: number;
  source: LogSource;
  message: string;
};

export type LogFilter = 'all' | LogSource;

/** "forward_swipe" -> "Forward swipe". */
export function humanizeGesture(gesture: string): string {
  const words = gesture.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown gesture';
}

export function describeButtonPress(event: ButtonPressEvent): InputDescription {
  return {
    kind: 'button',
    title: event.pressType === 'long' ? 'Long press' : 'Short press',
    detail: `Button: ${event.buttonId || 'unknown'}`,
  };
}

/** The SDK reports taps and swipes on one `touch_event` stream; split them by gesture name. */
export function describeTouch(event: TouchEvent): InputDescription {
  const gesture = event.gestureName || '';
  return {
    kind: gesture.toLowerCase().includes('swipe') ? 'swipe' : 'touch',
    title: humanizeGesture(gesture),
    detail: event.deviceModel ? `Touchpad · ${event.deviceModel}` : 'Touchpad',
  };
}

export function describeHeadUp(event: HeadUpEvent): InputDescription {
  return {
    kind: 'head',
    title: event.up ? 'Head up' : 'Head down',
    detail: 'Head position',
  };
}

/** Newest first, never longer than `max`. */
export function prependCapped<T>(items: readonly T[], item: T, max: number): T[] {
  return [item, ...items].slice(0, Math.max(0, max));
}

export function filterLog(entries: readonly LogEntry[], filter: LogFilter): readonly LogEntry[] {
  return filter === 'all' ? entries : entries.filter((entry) => entry.source === filter);
}

/** Local wall-clock time as HH:MM:SS. */
export function formatClock(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return 'Unknown error';
}
