import { CaptureQueue, QUEUE_LIMIT } from './queue';
import type { CaptureRecord } from './records';

function record(n: number): CaptureRecord {
  return { id: `r${n}`, kind: 'speech', at: '2026-11-02T09:15:00.000Z', text: `thing ${n}` };
}

function records(from: number, to: number): CaptureRecord[] {
  return Array.from({ length: to - from + 1 }, (_, index) => record(from + index));
}

describe('CaptureQueue', () => {
  it('keeps records in order and hands out the oldest first', () => {
    const queue = new CaptureQueue();
    queue.add(records(1, 3));

    expect(queue.size).toBe(3);
    expect(queue.peek(2).map((item) => item.id)).toEqual(['r1', 'r2']);
    expect(queue.size).toBe(3);
  });

  it('removes only the records the appliance saved', () => {
    const queue = new CaptureQueue(records(1, 3));
    queue.remove(['r2']);

    expect(queue.snapshot().map((item) => item.id)).toEqual(['r1', 'r3']);
  });

  it('drops the oldest records once it is full, and reports how many', () => {
    const queue = new CaptureQueue(records(1, QUEUE_LIMIT));

    const dropped = queue.add(records(QUEUE_LIMIT + 1, QUEUE_LIMIT + 3));

    expect(dropped).toBe(3);
    expect(queue.size).toBe(QUEUE_LIMIT);
    expect(queue.peek(1)[0].id).toBe('r4');
  });

  it('waits longer after each failure, up to five minutes, and resets on success', () => {
    const queue = new CaptureQueue(records(1, 1));
    const now = 1_000_000;

    expect(queue.canAttempt(now)).toBe(true);
    expect(queue.recordFailure(now)).toBe(5_000);
    expect(queue.canAttempt(now + 4_999)).toBe(false);
    expect(queue.canAttempt(now + 5_000)).toBe(true);

    expect(queue.recordFailure(now)).toBe(10_000);
    expect(queue.recordFailure(now)).toBe(20_000);
    for (let i = 0; i < 10; i += 1) {
      queue.recordFailure(now);
    }
    expect(queue.recordFailure(now)).toBe(300_000);

    queue.recordSuccess();
    expect(queue.canAttempt(now)).toBe(true);
    expect(queue.recordFailure(now)).toBe(5_000);
  });

  it('clears records and backoff together', () => {
    const queue = new CaptureQueue(records(1, 2));
    queue.recordFailure(0);

    queue.clear();

    expect(queue.size).toBe(0);
    expect(queue.canAttempt(0)).toBe(true);
  });
});
