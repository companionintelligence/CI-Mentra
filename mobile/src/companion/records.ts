import type { BatteryStatusEvent, ButtonPressEvent, LocalTranscriptionEvent, TouchEvent } from '@mentra/bluetooth-sdk';

import { humanizeGesture } from '../lib/feed';

/** The kinds the phone sends. The appliance also accepts `photo`, which the glasses send on their own. */
export type CaptureKind = 'speech' | 'input' | 'device';

/** One thing the glasses did or said. `id` is unique per phone and never reused. */
export interface CaptureRecord {
  id: string;
  kind: CaptureKind;
  /** ISO 8601 time the thing happened. */
  at: string;
  text: string;
}

/** Longest text the appliance accepts for one record. */
export const CAPTURE_TEXT_LIMIT = 1000;

/** The glasses display holds about this much text. Longer answers are cut at a word. */
export const GLASS_TEXT_LIMIT = 280;

/**
 * A record id that is unique across launches. The time keeps ids apart after a
 * restart, and the sequence keeps them apart within one millisecond.
 */
export function recordId(now: number, sequence: number): string {
  return `${now.toString(36)}-${sequence.toString(36)}`;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, CAPTURE_TEXT_LIMIT);
}

/** SDK timestamps are epoch milliseconds. A missing or impossible one falls back to the phone clock. */
function timeOf(stamp: number | undefined, now: number): string {
  const date = new Date(typeof stamp === 'number' && stamp > 0 ? stamp : now);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(now).toISOString();
}

/** A final transcript from the glasses microphone. Partial results are not stored. */
export function speechRecord(
  event: Pick<LocalTranscriptionEvent, 'text' | 'isFinal'>,
  now: number,
  sequence: number,
): CaptureRecord | null {
  const text = cleanText(event.text ?? '');
  if (!event.isFinal || !text) {
    return null;
  }
  return { id: recordId(now, sequence), kind: 'speech', at: new Date(now).toISOString(), text };
}

export function buttonRecord(
  event: Pick<ButtonPressEvent, 'buttonId' | 'pressType' | 'timestamp'>,
  now: number,
  sequence: number,
): CaptureRecord {
  return {
    id: recordId(now, sequence),
    kind: 'input',
    at: timeOf(event.timestamp, now),
    text: `Glasses button ${event.buttonId || 'main'}: ${event.pressType} press.`,
  };
}

export function touchRecord(
  event: Pick<TouchEvent, 'gestureName' | 'timestamp'>,
  now: number,
  sequence: number,
): CaptureRecord {
  return {
    id: recordId(now, sequence),
    kind: 'input',
    at: timeOf(event.timestamp, now),
    text: `Glasses touch: ${humanizeGesture(event.gestureName)}.`,
  };
}

export function headRecord(up: boolean, now: number, sequence: number): CaptureRecord {
  return {
    id: recordId(now, sequence),
    kind: 'input',
    at: new Date(now).toISOString(),
    text: `Glasses head ${up ? 'raised' : 'lowered'}.`,
  };
}

export function batteryRecord(
  event: Pick<BatteryStatusEvent, 'level' | 'charging' | 'timestamp'>,
  now: number,
  sequence: number,
): CaptureRecord {
  const level = Math.round(Math.max(0, Math.min(100, event.level)));
  return {
    id: recordId(now, sequence),
    kind: 'device',
    at: timeOf(event.timestamp, now),
    text: `Glasses battery ${level}%${event.charging ? ', charging' : ''}.`,
  };
}

export function statusRecord(text: string, now: number, sequence: number): CaptureRecord {
  return {
    id: recordId(now, sequence),
    kind: 'device',
    at: new Date(now).toISOString(),
    text: cleanText(text),
  };
}

/** Lets through at most one event per interval. Used for the sources that report often. */
export class Throttle {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs: number) {}

  allow(now: number): boolean {
    if (now - this.last < this.intervalMs) {
      return false;
    }
    this.last = now;
    return true;
  }
}

/** Cut an answer to fit the glasses display, at a word where one is close enough. */
export function glassText(text: string, limit = GLASS_TEXT_LIMIT): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  const cut = normalized.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const kept = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${kept.trimEnd()}…`;
}
