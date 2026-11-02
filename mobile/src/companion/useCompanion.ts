// Connects the glasses to the appliance: sign-in, the capture queue, asking the agent and taking photos.
// Mount it once, at the app root, next to the Bluetooth session it reads from.
import BluetoothSdk, {
  type BatteryStatusEvent,
  type ButtonPressEvent,
  type HeadUpEvent,
  type LocalTranscriptionEvent,
  type TouchEvent,
} from '@mentra/bluetooth-sdk';
import { useBluetoothEvent, type GlassesRuntimeState } from '@mentra/bluetooth-sdk/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CompanionApiError, createCompanionApi, type CompanionApi, type CompanionStatus } from './api';
import { currentAccessToken, signIn, signOut } from './auth';
import { normalizeApplianceUrl } from './config';
import { loadQueue, loadSettings, saveQueue, saveSettings } from './persistence';
import { CaptureQueue } from './queue';
import {
  batteryRecord,
  buttonRecord,
  glassText,
  headRecord,
  speechRecord,
  statusRecord,
  Throttle,
  touchRecord,
  type CaptureRecord,
} from './records';
import { DEFAULT_SETTINGS, parseSettings, type CompanionSettings } from './settings';
import { formatError } from '../lib/feed';

/** How long a short press keeps the next spoken sentence for the agent. */
const ASK_WINDOW_MS = 20_000;
const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_BATCH = 50;
const PERSIST_DELAY_MS = 1_000;
const HEAD_INTERVAL_MS = 30_000;
const BATTERY_INTERVAL_MS = 15 * 60_000;
const LOG_LIMIT = 30;

export type CompanionTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface CompanionNotice {
  tone: CompanionTone;
  message: string;
}

export interface CompanionLogLine {
  id: number;
  text: string;
  tone: CompanionTone;
}

export type CaptureSource = 'captureSpeech' | 'captureInput' | 'captureDevice';

export interface CompanionController {
  settings: CompanionSettings;
  settingsLoaded: boolean;
  /** The signed-in owner as the appliance reports them, or null when signed out. */
  account: CompanionStatus | null;
  busy: string | null;
  notice: CompanionNotice | null;
  queueSize: number;
  lastAnswer: string | null;
  /** True for a short time after a short press, while the next sentence goes to the agent. */
  askArmed: boolean;
  glassesReady: boolean;
  log: CompanionLogLine[];
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  saveAddress(text: string): void;
  setCapture(enabled: boolean): void;
  setSource(source: CaptureSource, enabled: boolean): void;
  armAsk(): void;
  ask(text: string): Promise<void>;
  takePhoto(): Promise<void>;
  dismissNotice(): void;
}

interface EventHandlers {
  transcript(event: LocalTranscriptionEvent): void;
  button(event: ButtonPressEvent): void;
  touch(event: TouchEvent): void;
  head(event: HeadUpEvent): void;
  battery(event: BatteryStatusEvent): void;
}

const NO_HANDLERS: EventHandlers = {
  transcript: () => undefined,
  button: () => undefined,
  touch: () => undefined,
  head: () => undefined,
  battery: () => undefined,
};

export function useCompanion(glasses: GlassesRuntimeState): CompanionController {
  const glassesReady = glasses.connection.state === 'connected' && Boolean(glasses.connection.fullyBooted);

  const [settings, setSettings] = useState<CompanionSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [account, setAccount] = useState<CompanionStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<CompanionNotice | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [askArmed, setAskArmed] = useState(false);
  const [logLines, setLogLines] = useState<CompanionLogLine[]>([]);
  const [headThrottle] = useState(() => new Throttle(HEAD_INTERVAL_MS));
  const [batteryThrottle] = useState(() => new Throttle(BATTERY_INTERVAL_MS));

  const settingsRef = useRef(settings);
  const accountRef = useRef(account);
  const readyRef = useRef(glassesReady);
  const queueRef = useRef(new CaptureQueue());
  const apiRef = useRef<CompanionApi | null>(null);
  const askArmedRef = useRef(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micOnRef = useRef(false);
  const flushingRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceRef = useRef(0);
  const logSequenceRef = useRef(0);
  const handlersRef = useRef<EventHandlers>(NO_HANDLERS);
  const previousReadyRef = useRef<boolean | null>(null);

  const log = useCallback((text: string, tone: CompanionTone = 'neutral') => {
    logSequenceRef.current += 1;
    const line: CompanionLogLine = { id: logSequenceRef.current, text, tone };
    setLogLines((lines) => [line, ...lines].slice(0, LOG_LIMIT));
  }, []);

  const showNotice = useCallback((tone: CompanionTone, message: string) => setNotice({ tone, message }), []);

  const nextSequence = useCallback(() => {
    sequenceRef.current += 1;
    return sequenceRef.current;
  }, []);

  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      saveQueue(queueRef.current.snapshot()).catch(() => log('Could not save the glasses queue on this phone.', 'warning'));
    }, PERSIST_DELAY_MS);
  }, [log]);

  const enqueue = useCallback(
    (records: CaptureRecord[]) => {
      if (records.length === 0) {
        return;
      }
      const dropped = queueRef.current.add(records);
      setQueueSize(queueRef.current.size);
      if (dropped > 0) {
        log(`The queue is full, so ${dropped} of the oldest glasses records were dropped.`, 'warning');
      }
      schedulePersist();
    },
    [log, schedulePersist],
  );

  const updateSettings = useCallback((patch: Partial<CompanionSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveSettings(next).catch(() => log('Could not save the companion settings on this phone.', 'warning'));
  }, [log]);

  // Load what the user chose and what was still waiting to be sent.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSettings(), loadQueue()])
      .then(([rawSettings, stored]) => {
        if (cancelled) {
          return;
        }
        const loaded = parseSettings(rawSettings);
        settingsRef.current = loaded;
        setSettings(loaded);
        queueRef.current = new CaptureQueue([...stored, ...queueRef.current.snapshot()]);
        setQueueSize(queueRef.current.size);
        setSettingsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSettingsLoaded(true);
          log('Could not read the saved companion settings, so the defaults are in use.', 'warning');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [log]);

  // One appliance client, for the address the user saved.
  const applianceUrl = settings.applianceUrl;
  const api = useMemo(() => (applianceUrl ? createCompanionApi({ baseUrl: applianceUrl }) : null), [applianceUrl]);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  const refreshAccount = useCallback(async () => {
    const client = apiRef.current;
    if (!client) {
      setAccount(null);
      return;
    }
    const token = await currentAccessToken();
    if (!token) {
      setAccount(null);
      return;
    }
    try {
      const status = await client.status(token);
      if (status.authenticated) {
        setAccount(status);
      } else {
        await signOut();
        setAccount(null);
        showNotice('warning', 'This CI-Portal account does not own this appliance. Sign in with the owner account.');
      }
    } catch (error) {
      if (error instanceof CompanionApiError && error.status === 401) {
        await signOut();
        setAccount(null);
      } else {
        showNotice('warning', `Could not check your account: ${formatError(error)}`);
      }
    }
  }, [showNotice]);

  useEffect(() => {
    if (settingsLoaded) {
      refreshAccount().catch(() => undefined);
    }
  }, [settingsLoaded, applianceUrl, refreshAccount]);

  // Stop the glasses microphone when the app goes away.
  useEffect(() => {
    return () => {
      if (micOnRef.current) {
        micOnRef.current = false;
        BluetoothSdk.setMicState(false).catch(() => undefined);
      }
    };
  }, []);

  const disarm = useCallback(() => {
    askArmedRef.current = false;
    setAskArmed(false);
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }, []);

  const armAsk = useCallback(() => {
    if (!accountRef.current) {
      showNotice('warning', 'Sign in to ask your companion.');
      return;
    }
    askArmedRef.current = true;
    setAskArmed(true);
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
    }
    armTimerRef.current = setTimeout(() => {
      armTimerRef.current = null;
      disarm();
    }, ASK_WINDOW_MS);
    log('Ready for your question. Say it within 20 seconds.');
  }, [disarm, log, showNotice]);

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim();
      const client = apiRef.current;
      if (!question) {
        return;
      }
      if (!client) {
        showNotice('warning', 'Enter your appliance address first.');
        return;
      }
      setBusy('Asking your companion');
      try {
        const token = await currentAccessToken();
        if (!token) {
          showNotice('warning', 'Sign in to ask your companion.');
          return;
        }
        const reply = await client.ask(token, question, 'glasses');
        setLastAnswer(reply.answer);
        log('Your companion answered.', 'success');
        if (readyRef.current) {
          try {
            await BluetoothSdk.displayText(glassText(reply.answer));
          } catch (error) {
            log(`Could not show the answer on the glasses: ${formatError(error)}`, 'warning');
          }
        }
      } catch (error) {
        showNotice('danger', `Could not reach your companion: ${formatError(error)}`);
      } finally {
        setBusy(null);
      }
    },
    [log, showNotice],
  );

  const flush = useCallback(async () => {
    const client = apiRef.current;
    const queue = queueRef.current;
    if (!client || queue.size === 0 || flushingRef.current || !settingsRef.current.captureEnabled) {
      return;
    }
    if (!queue.canAttempt(Date.now())) {
      return;
    }
    flushingRef.current = true;
    try {
      const token = await currentAccessToken();
      if (!token) {
        return;
      }
      const batch = queue.peek(FLUSH_BATCH);
      const result = await client.capture(token, batch);
      if (!result.memoryEnabled) {
        // Memory is off on the appliance, so nothing is kept. The batch is dropped, not retried.
        queue.remove(batch.map((record) => record.id));
        log('Memory is off on your appliance, so these glasses records were not kept.', 'warning');
      } else {
        queue.remove(result.saved);
        if (result.failed.length > 0) {
          queue.recordFailure(Date.now());
        } else {
          queue.recordSuccess();
        }
      }
    } catch (error) {
      if (error instanceof CompanionApiError && error.status === 401) {
        await signOut();
        setAccount(null);
        showNotice('danger', 'Your sign-in expired. Sign in again to keep sending glasses data.');
      } else {
        const delay = queue.recordFailure(Date.now());
        log(`Could not send glasses data. Trying again in ${Math.round(delay / 1000)} seconds.`, 'warning');
      }
    } finally {
      flushingRef.current = false;
      setQueueSize(queue.size);
      schedulePersist();
    }
  }, [log, schedulePersist, showNotice]);

  useEffect(() => {
    const timer = setInterval(() => {
      flush().catch(() => undefined);
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flush]);

  const handlers = useMemo<EventHandlers>(
    () => ({
      transcript(event) {
        if (!event.isFinal) {
          return;
        }
        if (askArmedRef.current) {
          disarm();
          ask(event.text ?? '').catch(() => undefined);
          return;
        }
        const current = settingsRef.current;
        if (current.captureEnabled && current.captureSpeech) {
          enqueue(compact([speechRecord(event, Date.now(), nextSequence())]));
        }
      },
      button(event) {
        const current = settingsRef.current;
        if (current.captureEnabled && current.captureInput) {
          enqueue([buttonRecord(event, Date.now(), nextSequence())]);
        }
        if (event.pressType === 'short') {
          armAsk();
        } else {
          disarm();
        }
      },
      touch(event) {
        const current = settingsRef.current;
        if (current.captureEnabled && current.captureInput) {
          enqueue([touchRecord(event, Date.now(), nextSequence())]);
        }
      },
      head(event) {
        const current = settingsRef.current;
        const now = Date.now();
        if (current.captureEnabled && current.captureInput && headThrottle.allow(now)) {
          enqueue([headRecord(event.up, now, nextSequence())]);
        }
      },
      battery(event) {
        const current = settingsRef.current;
        const now = Date.now();
        if (current.captureEnabled && current.captureDevice && batteryThrottle.allow(now)) {
          enqueue([batteryRecord(event, now, nextSequence())]);
        }
      },
    }),
    [ask, armAsk, batteryThrottle, disarm, enqueue, headThrottle, nextSequence],
  );

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useBluetoothEvent('local_transcription', (event) => handlersRef.current.transcript(event));
  useBluetoothEvent('button_press', (event) => handlersRef.current.button(event));
  useBluetoothEvent('touch_event', (event) => handlersRef.current.touch(event));
  useBluetoothEvent('head_up', (event) => handlersRef.current.head(event));
  useBluetoothEvent('battery_status', (event) => handlersRef.current.battery(event));

  // Record connection changes after the first reading, so a restored connection is not logged as new.
  useEffect(() => {
    readyRef.current = glassesReady;
    const previous = previousReadyRef.current;
    previousReadyRef.current = glassesReady;
    if (previous === null || previous === glassesReady) {
      return;
    }
    const current = settingsRef.current;
    if (current.captureEnabled && current.captureDevice) {
      enqueue([statusRecord(glassesReady ? 'Glasses connected and ready.' : 'Glasses disconnected.', Date.now(), nextSequence())]);
    }
    if (!glassesReady) {
      disarm();
    }
  }, [disarm, enqueue, glassesReady, nextSequence]);

  // The microphone runs while the glasses are ready and either capture or a question needs it.
  useEffect(() => {
    const wanted = Boolean(account) && glassesReady && ((settings.captureEnabled && settings.captureSpeech) || askArmed);
    if (wanted === micOnRef.current) {
      return;
    }
    micOnRef.current = wanted;
    const change = wanted ? BluetoothSdk.setMicState(true, true, true, false) : BluetoothSdk.setMicState(false);
    change.catch((error: unknown) => {
      micOnRef.current = !wanted;
      log(`Could not ${wanted ? 'start' : 'stop'} the glasses microphone: ${formatError(error)}`, 'danger');
    });
  }, [account, askArmed, glassesReady, log, settings.captureEnabled, settings.captureSpeech]);

  const saveAddress = useCallback(
    (text: string) => {
      const normalized = normalizeApplianceUrl(text);
      if (!normalized) {
        showNotice(
          'warning',
          'Enter an https address, such as https://ci-mentra.example.ts.net. Plain http works only for localhost.',
        );
        return;
      }
      updateSettings({ applianceUrl: normalized });
      log(`Appliance set to ${normalized}.`);
    },
    [log, showNotice, updateSettings],
  );

  const setCapture = useCallback(
    (enabled: boolean) => {
      updateSettings({ captureEnabled: enabled });
      log(enabled ? 'Capture to memory is on.' : 'Capture to memory is off. Nothing new is stored.', enabled ? 'success' : 'neutral');
    },
    [log, updateSettings],
  );

  const setSource = useCallback(
    (source: CaptureSource, enabled: boolean) => {
      updateSettings({ [source]: enabled } as Partial<CompanionSettings>);
    },
    [updateSettings],
  );

  const signInAction = useCallback(async () => {
    if (!apiRef.current) {
      showNotice('warning', 'Enter your appliance address first, so the app knows where to send your data.');
      return;
    }
    setBusy('Signing in');
    try {
      await signIn();
      await refreshAccount();
      log('Signed in to CI-Portal.', 'success');
    } catch (error) {
      showNotice('danger', `Sign-in did not finish: ${formatError(error)}`);
    } finally {
      setBusy(null);
    }
  }, [log, refreshAccount, showNotice]);

  const signOutAction = useCallback(async () => {
    await signOut();
    setAccount(null);
    disarm();
    log('Signed out. Glasses data that is still waiting stays on this phone.');
  }, [disarm, log]);

  const takePhoto = useCallback(async () => {
    const client = apiRef.current;
    if (!client || !accountRef.current) {
      showNotice('warning', 'Sign in and set your appliance address first.');
      return;
    }
    if (!readyRef.current) {
      showNotice('warning', 'Connect your glasses first.');
      return;
    }
    setBusy('Taking a photo');
    try {
      const token = await currentAccessToken();
      if (!token) {
        showNotice('warning', 'Sign in again to send the photo.');
        return;
      }
      // The glasses send the photo through the phone to the appliance's photo endpoint, with this token.
      await BluetoothSdk.requestPhoto({
        size: 'medium',
        webhookUrl: client.photoUploadUrl(),
        authToken: token,
        transferMethod: 'ble',
        sound: true,
        save: false,
        exposureTimeNs: null,
        iso: null,
      });
      log('Photo sent to your appliance.', 'success');
    } catch (error) {
      showNotice('danger', `The photo did not finish: ${formatError(error)}`);
    } finally {
      setBusy(null);
    }
  }, [log, showNotice]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    settings,
    settingsLoaded,
    account,
    busy,
    notice,
    queueSize,
    lastAnswer,
    askArmed,
    glassesReady,
    log: logLines,
    signIn: signInAction,
    signOut: signOutAction,
    saveAddress,
    setCapture,
    setSource,
    armAsk,
    ask,
    takePhoto,
    dismissNotice,
  };
}

function compact(records: Array<CaptureRecord | null>): CaptureRecord[] {
  return records.filter((record): record is CaptureRecord => record !== null);
}
