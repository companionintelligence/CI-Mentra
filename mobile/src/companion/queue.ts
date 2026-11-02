import type { CaptureRecord } from './records';

/** Most records kept while the appliance cannot be reached. Oldest go first. */
export const QUEUE_LIMIT = 2000;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Glasses records waiting to reach the appliance. A record leaves the queue only
 * once the appliance has saved it. A failed send waits before the next try, and
 * the wait doubles up to five minutes.
 */
export class CaptureQueue {
  private records: CaptureRecord[];
  private failures = 0;
  private retryAt = 0;

  constructor(initial: CaptureRecord[] = []) {
    this.records = initial.slice(-QUEUE_LIMIT);
  }

  get size(): number {
    return this.records.length;
  }

  snapshot(): CaptureRecord[] {
    return this.records.slice();
  }

  /** Adds records. Returns how many of the oldest were dropped to stay within the limit. */
  add(items: readonly CaptureRecord[]): number {
    this.records.push(...items);
    const overflow = Math.max(0, this.records.length - QUEUE_LIMIT);
    if (overflow > 0) {
      this.records.splice(0, overflow);
    }
    return overflow;
  }

  /** The next batch to send, oldest first. Nothing is removed. */
  peek(max: number): CaptureRecord[] {
    return this.records.slice(0, max);
  }

  /** Removes records the appliance has saved. */
  remove(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }
    const gone = new Set(ids);
    this.records = this.records.filter((record) => !gone.has(record.id));
  }

  clear(): void {
    this.records = [];
    this.failures = 0;
    this.retryAt = 0;
  }

  canAttempt(now: number): boolean {
    return now >= this.retryAt;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.retryAt = 0;
  }

  /** Records a failed send and returns how long to wait before the next try. */
  recordFailure(now: number): number {
    this.failures += 1;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.failures - 1));
    this.retryAt = now + delay;
    return delay;
  }
}
