import { createLatestOnlySender } from './latestOnlySender';

/** Resolves pending promise callbacks queued by the sender. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('createLatestOnlySender', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('a burst collapses to its last value after the delay', async () => {
    const sent: string[] = [];
    const sender = createLatestOnlySender<string>({ delayMs: 400, send: async (value) => void sent.push(value) });
    sender.schedule('H');
    jest.advanceTimersByTime(200);
    sender.schedule('He');
    jest.advanceTimersByTime(200);
    sender.schedule('Hello');
    jest.advanceTimersByTime(399);
    expect(sent).toEqual([]);
    jest.advanceTimersByTime(1);
    await settle();
    expect(sent).toEqual(['Hello']);
  });

  test('flush sends right away', async () => {
    const sent: string[] = [];
    const sender = createLatestOnlySender<string>({ delayMs: 400, send: async (value) => void sent.push(value) });
    sender.schedule('Now');
    sender.flush();
    await settle();
    expect(sent).toEqual(['Now']);
    jest.advanceTimersByTime(1_000);
    await settle();
    expect(sent).toEqual(['Now']);
  });

  test('never overlaps sends; only the latest queued value follows', async () => {
    const sent: string[] = [];
    const releases: Array<() => void> = [];
    const sender = createLatestOnlySender<string>({
      delayMs: 100,
      send: (value) =>
        new Promise<void>((resolve) => {
          sent.push(value);
          releases.push(resolve);
        }),
    });
    sender.schedule('one');
    sender.flush();
    await settle();
    expect(sent).toEqual(['one']);

    sender.schedule('two');
    sender.schedule('three');
    jest.advanceTimersByTime(100);
    await settle();
    expect(sent).toEqual(['one']);

    releases[0]?.();
    await settle();
    expect(sent).toEqual(['one', 'three']);
  });

  test('cancel drops the queued value', async () => {
    const send = jest.fn(async () => undefined);
    const sender = createLatestOnlySender<string>({ delayMs: 100, send });
    sender.schedule('stale');
    sender.cancel();
    jest.advanceTimersByTime(1_000);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  test('reports failures and keeps working', async () => {
    const errors: unknown[] = [];
    const send = jest
      .fn<Promise<void>, [string]>()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue(undefined);
    const sender = createLatestOnlySender<string>({ delayMs: 100, send, onError: (error) => errors.push(error) });
    sender.schedule('first');
    sender.flush();
    await settle();
    expect(errors).toHaveLength(1);
    sender.schedule('second');
    sender.flush();
    await settle();
    expect(send).toHaveBeenLastCalledWith('second');
  });

  test('dispose stops everything', async () => {
    const send = jest.fn(async () => undefined);
    const sender = createLatestOnlySender<string>({ delayMs: 100, send });
    sender.schedule('late');
    sender.dispose();
    sender.schedule('after');
    sender.flush();
    jest.advanceTimersByTime(1_000);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
