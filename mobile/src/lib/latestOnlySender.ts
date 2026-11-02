export type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type LatestOnlySender<T> = {
  /** Queue a value. Only the newest value queued within `delayMs` is sent. */
  schedule: (value: T) => void;
  /** Send the queued value now instead of waiting for the delay. */
  flush: () => void;
  /** Drop the queued value, for example right before clearing the display. */
  cancel: () => void;
  /** Stop all timers; later calls do nothing. */
  dispose: () => void;
};

export type LatestOnlySenderOptions<T> = {
  delayMs: number;
  send: (value: T) => Promise<void>;
  onError?: (error: unknown) => void;
  timers?: Timers;
};

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Debounces glasses display updates: bursts collapse to their last value, and a new send
 * never starts while the previous one is still in flight, so the glasses only ever receive
 * the latest text, in order. The SDK production checklist asks apps not to send rapid
 * display updates without debouncing.
 */
export function createLatestOnlySender<T>(options: LatestOnlySenderOptions<T>): LatestOnlySender<T> {
  const timers = options.timers ?? defaultTimers;
  let pending: { value: T } | null = null;
  let timer: unknown = null;
  let inFlight = false;
  let disposed = false;

  function clearTimer() {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function sendPending() {
    clearTimer();
    if (disposed || inFlight || pending === null) {
      return;
    }
    const { value } = pending;
    pending = null;
    inFlight = true;
    options
      .send(value)
      .catch((error: unknown) => {
        if (!disposed) {
          options.onError?.(error);
        }
      })
      .finally(() => {
        inFlight = false;
        // A value queued while this send was in flight goes out as soon as it finishes,
        // unless its own debounce timer is still running.
        if (pending !== null && timer === null) {
          sendPending();
        }
      });
  }

  return {
    schedule(value: T) {
      if (disposed) {
        return;
      }
      pending = { value };
      clearTimer();
      timer = timers.setTimeout(() => {
        timer = null;
        sendPending();
      }, options.delayMs);
    },
    flush() {
      sendPending();
    },
    cancel() {
      pending = null;
      clearTimer();
    },
    dispose() {
      disposed = true;
      pending = null;
      clearTimer();
    },
  };
}
