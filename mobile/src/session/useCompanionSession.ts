// Adapted from the Mentra Bluetooth SDK Starter Kit (Apache-2.0, Copyright 2026 Mentra Labs, Inc.):
// examples/react-native/src/useBluetoothSdkExample.ts. Modified for Companion; see mobile/README.md#attribution.
import BluetoothSdk, { type ConnectOptions, type Device, type DeviceModel } from '@mentra/bluetooth-sdk';
import {
  useBluetoothEvent,
  useMentraBluetooth,
  type GlassesRuntimeState,
} from '@mentra/bluetooth-sdk/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { describeVerdict } from '../lib/androidPermissions';
import {
  describeButtonPress,
  describeHeadUp,
  describeTouch,
  formatError,
  prependCapped,
  type InputDescription,
  type InputFeedItem,
  type LogEntry,
  type LogSource,
} from '../lib/feed';
import { displayAvailability, lifecycleView, type DisplayAvailability } from '../lib/glassesStatus';
import { createLatestOnlySender } from '../lib/latestOnlySender';
import { DEFAULT_SCAN_MODEL, isKnownModel, resolveConnectedModel, SCAN_MODELS, scanModelLabel, type ScanModel } from '../lib/models';
import { hasBluetoothPermissions, requestBluetoothPermissions } from './permissions';
import { savedDeviceStorage } from './savedDeviceStorage';

export const SCAN_TIMEOUT_MS = 15_000;
const DISPLAY_DEBOUNCE_MS = 400;
const MAX_INPUT_EVENTS = 100;
const MAX_LOG_ENTRIES = 300;

/**
 * This version does not relay phone notifications to the glasses, so it opts out of the iOS
 * ANCS authorization prompt the SDK otherwise requests while connecting Mentra Live.
 */
const CONNECT_OPTIONS: ConnectOptions = { requiresAncs: false };

export type Notice = {
  tone: 'danger' | 'warning' | 'info';
  message: string;
  /** Show an "Open Settings" action, for permissions the system will no longer prompt for. */
  openSettings?: boolean;
};

export type ScanState = {
  model: ScanModel;
  active: boolean;
  devices: Device[];
  selected: Device | null;
  startedAt: number | null;
  timeoutMs: number;
  /** SDK advisory for an empty scan, such as glasses already connected to another app. */
  hint: string | null;
  /** Result count of the last finished scan; null before the first one. */
  lastResultCount: number | null;
};

export type CompanionSession = {
  glasses: GlassesRuntimeState;
  connectedModel: DeviceModel | null;
  savedDevice: Device | null;
  scan: ScanState;
  /** Label of the connection action in flight, if any. */
  busy: string | null;
  notice: Notice | null;
  display: DisplayAvailability;
  inputEvents: InputFeedItem[];
  log: LogEntry[];
  selectScanModel: (model: ScanModel) => void;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  selectDevice: (device: Device) => void;
  connectSelected: () => Promise<void>;
  reconnectSaved: () => Promise<void>;
  cancelConnecting: () => Promise<void>;
  disconnect: () => Promise<void>;
  forgetSaved: () => Promise<void>;
  /** Debounced: rapid calls collapse to the latest text. `immediate` skips the wait. */
  showText: (text: string, immediate: boolean) => void;
  clearDisplay: () => Promise<void>;
  dismissNotice: () => void;
  openSettings: () => void;
  clearInputEvents: () => void;
  clearLog: () => void;
};

function asScanModel(model: DeviceModel): ScanModel {
  return (SCAN_MODELS as readonly string[]).includes(model) ? (model as ScanModel) : DEFAULT_SCAN_MODEL;
}

/**
 * The app's single Bluetooth session owner. It wraps the SDK's `useMentraBluetooth` hook,
 * keeps the input-event feed and the console log, and exposes the user actions. Mount it
 * once, at the app root: every SDK subscription here is created through `useBluetoothEvent`
 * or an effect with a cleanup, so all of them are removed when the owner unmounts.
 */
export function useCompanionSession(): CompanionSession {
  const nextIdRef = useRef(1);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [inputEvents, setInputEvents] = useState<InputFeedItem[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [lastResultCount, setLastResultCount] = useState<number | null>(null);
  const [targetModel, setTargetModel] = useState<DeviceModel | null>(null);
  const userDisconnectRef = useRef(false);
  const autoReconnectSettledRef = useRef(false);

  const appendLog = useCallback((source: LogSource, message: string) => {
    const entry: LogEntry = { id: nextIdRef.current++, at: Date.now(), source, message };
    setLog((current) => prependCapped(current, entry, MAX_LOG_ENTRIES));
  }, []);

  const pushInput = useCallback((description: InputDescription) => {
    const item: InputFeedItem = { ...description, id: nextIdRef.current++, at: Date.now() };
    setInputEvents((current) => prependCapped(current, item, MAX_INPUT_EVENTS));
  }, []);

  const mentra = useMentraBluetooth({
    defaultDeviceStorage: savedDeviceStorage,
    defaultModel: DEFAULT_SCAN_MODEL,
    scanTimeoutMs: SCAN_TIMEOUT_MS,
    requiresAncs: false,
    // Background SDK failures (status subscription, saved-device restore) go to the console;
    // user-started actions also raise a notice from their own catch blocks.
    onError: (error) => appendLog('error', `SDK: ${formatError(error)}`),
  });
  const { glasses } = mentra;

  // Hardware input feed and diagnostics. useBluetoothEvent removes each native
  // subscription when this hook's owner unmounts.
  useBluetoothEvent('button_press', (event) => pushInput(describeButtonPress(event)));
  useBluetoothEvent('touch_event', (event) => pushInput(describeTouch(event)));
  useBluetoothEvent('head_up', (event) => pushInput(describeHeadUp(event)));
  useBluetoothEvent('log', (event) => appendLog('sdk', event.message));
  useBluetoothEvent('pair_failure', (event) => {
    const message = `Pairing failed: ${event.error || 'unknown reason'}. Put the glasses in pairing mode and try again.`;
    appendLog('error', message);
    setNotice({ tone: 'danger', message });
  });
  useBluetoothEvent('glasses_not_ready', (event) => {
    const message = event.message || 'The glasses are not ready yet.';
    appendLog('error', `Not ready: ${message}`);
    setNotice({ tone: 'warning', message });
  });
  useBluetoothEvent('compatible_glasses_search_stop', (event) => {
    appendLog('app', `Scan stopped for ${event.deviceModel || 'glasses'}.`);
  });

  const savedDevice = mentra.defaultDevice;
  const connectedModel = resolveConnectedModel(
    glasses.connected ? glasses.device.deviceModel : undefined,
    targetModel ?? savedDevice?.model ?? null,
  );
  const display = displayAvailability(glasses, connectedModel);

  const displaySender = useMemo(
    () =>
      createLatestOnlySender<string>({
        delayMs: DISPLAY_DEBOUNCE_MS,
        send: async (text) => {
          await BluetoothSdk.displayText(text);
          // Log the length only: what the user types can be personal.
          appendLog('app', `Display: sent ${text.length} characters.`);
        },
        onError: (error) => {
          const message = `Could not update the display: ${formatError(error)}`;
          appendLog('error', message);
          setNotice({ tone: 'danger', message });
        },
      }),
    [appendLog],
  );
  useEffect(() => () => displaySender.dispose(), [displaySender]);

  // Lifecycle transitions: log them, drop stale display updates, and tell the user when the
  // link drops without them asking for it.
  const connectionKey = glasses.connection.state === 'connected'
    ? `connected:${glasses.connection.fullyBooted ? 'ready' : 'booting'}`
    : glasses.connection.state;
  const previousKeyRef = useRef(connectionKey);
  useEffect(() => {
    const previous = previousKeyRef.current;
    if (previous === connectionKey) {
      return;
    }
    previousKeyRef.current = connectionKey;
    appendLog('app', `Glasses: ${lifecycleView(glasses.connection).title.toLowerCase()}.`);

    const wasConnected = previous.startsWith('connected');
    if (connectionKey === 'connected:ready') {
      setNotice((current) => (current?.tone === 'danger' ? current : null));
    }
    if (wasConnected && !glasses.connected) {
      displaySender.cancel();
      if (userDisconnectRef.current) {
        userDisconnectRef.current = false;
      } else {
        setNotice({
          tone: 'warning',
          message:
            glasses.connection.state === 'disconnected'
              ? 'Lost the connection to your glasses. Reconnect when they are nearby.'
              : 'Lost the connection to your glasses. Trying to reconnect.',
        });
      }
    }
  }, [appendLog, connectionKey, displaySender, glasses]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label);
      appendLog('app', `${label}…`);
      try {
        await action();
      } catch (error) {
        const message = `${label} failed: ${formatError(error)}`;
        appendLog('error', message);
        setNotice({ tone: 'danger', message });
      } finally {
        setBusy((current) => (current === label ? null : current));
      }
    },
    [appendLog],
  );

  const ensurePermissions = useCallback(async () => {
    const verdict = await requestBluetoothPermissions();
    const message = describeVerdict(verdict);
    if (!verdict.ok) {
      appendLog('error', `Permissions: ${message ?? 'denied'}`);
      setNotice({ tone: 'danger', message: message ?? 'Bluetooth permission is required.', openSettings: verdict.blocked.length > 0 });
      return false;
    }
    if (message) {
      setNotice({ tone: 'info', message });
    }
    return true;
  }, [appendLog]);

  // Reconnect at launch to the glasses saved by the last successful connection, but only when
  // permissions are already granted: launch never shows a permission prompt.
  useEffect(() => {
    if (autoReconnectSettledRef.current || !savedDevice) {
      return;
    }
    autoReconnectSettledRef.current = true;
    if (glasses.connection.state !== 'disconnected') {
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!(await hasBluetoothPermissions())) {
        appendLog('app', `Saved glasses: ${savedDevice.name}. Tap Reconnect to connect.`);
        return;
      }
      if (cancelled) {
        return;
      }
      setTargetModel(savedDevice.model);
      await runAction(`Reconnect to ${savedDevice.name}`, () => mentra.connectDefault(CONNECT_OPTIONS));
    })();
    return () => {
      cancelled = true;
    };
    // Runs once, when the saved record first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedDevice]);

  const scanModel = asScanModel(mentra.scan.model);

  const selectScanModel = useCallback(
    (model: ScanModel) => {
      if (model !== scanModel) {
        mentra.scan.setModel(model);
        setLastResultCount(null);
      }
    },
    [mentra.scan, scanModel],
  );

  const startScan = useCallback(async () => {
    autoReconnectSettledRef.current = true;
    setNotice(null);
    if (!(await ensurePermissions())) {
      return;
    }
    setLastResultCount(null);
    setScanStartedAt(Date.now());
    appendLog('app', `Scanning for ${scanModelLabel(scanModel)} glasses.`);
    try {
      const devices = await mentra.scan.start(scanModel);
      setLastResultCount(devices.length);
      appendLog('app', `Scan finished: ${devices.length} found.`);
    } catch (error) {
      const message = `Scan failed: ${formatError(error)}`;
      appendLog('error', message);
      setNotice({ tone: 'danger', message });
    } finally {
      setScanStartedAt(null);
    }
  }, [appendLog, ensurePermissions, mentra.scan, scanModel]);

  const stopScan = useCallback(async () => {
    try {
      await mentra.scan.stop();
      setLastResultCount(mentra.scan.devices.length);
      appendLog('app', 'Scan stopped.');
    } catch (error) {
      appendLog('error', `Stop scan failed: ${formatError(error)}`);
    } finally {
      setScanStartedAt(null);
    }
  }, [appendLog, mentra.scan]);

  const selectDevice = useCallback((device: Device) => mentra.scan.selectDevice(device), [mentra.scan]);

  const connectSelected = useCallback(async () => {
    autoReconnectSettledRef.current = true;
    const device = mentra.scan.selectedDevice;
    if (!device) {
      setNotice({ tone: 'info', message: 'Choose your glasses in the list first.' });
      return;
    }
    if (!(await ensurePermissions())) {
      return;
    }
    setTargetModel(isKnownModel(device.model) ? device.model : null);
    userDisconnectRef.current = false;
    await runAction(`Connect to ${device.name}`, async () => {
      if (mentra.scan.active) {
        await mentra.scan.stop();
      }
      // The SDK saves the device as the default; the storage adapter persists it for restarts.
      await mentra.connect(device, CONNECT_OPTIONS);
    });
  }, [ensurePermissions, mentra, runAction]);

  const reconnectSaved = useCallback(async () => {
    autoReconnectSettledRef.current = true;
    if (!savedDevice) {
      return;
    }
    if (!(await ensurePermissions())) {
      return;
    }
    setTargetModel(savedDevice.model);
    userDisconnectRef.current = false;
    await runAction(`Reconnect to ${savedDevice.name}`, () => mentra.connectDefault(CONNECT_OPTIONS));
  }, [ensurePermissions, mentra, runAction, savedDevice]);

  /** Marks the next link drop as user-initiated, so it raises no "connection lost" notice. */
  const userInitiatedDrop = useCallback(async (action: () => Promise<void>) => {
    userDisconnectRef.current = true;
    try {
      await action();
    } catch (error) {
      userDisconnectRef.current = false;
      throw error;
    }
  }, []);

  const cancelConnecting = useCallback(async () => {
    await runAction('Cancel connection', () => userInitiatedDrop(() => BluetoothSdk.cancelConnectionAttempt()));
  }, [runAction, userInitiatedDrop]);

  const disconnect = useCallback(async () => {
    displaySender.cancel();
    await runAction('Disconnect', () => userInitiatedDrop(() => mentra.disconnect()));
  }, [displaySender, mentra, runAction, userInitiatedDrop]);

  const forgetSaved = useCallback(async () => {
    displaySender.cancel();
    await runAction('Forget glasses', () =>
      userInitiatedDrop(async () => {
        // Drops the link and the SDK's record of the glasses, then clears the SDK default
        // device and the app's saved record: the visible forget path the SDK notes ask for.
        await BluetoothSdk.forget();
        await mentra.clearDefaultDevice();
        setTargetModel(null);
      }),
    );
  }, [displaySender, mentra, runAction, userInitiatedDrop]);

  const showText = useCallback(
    (text: string, immediate: boolean) => {
      if (!display.available) {
        setNotice({ tone: 'info', message: display.message });
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      displaySender.schedule(trimmed);
      if (immediate) {
        displaySender.flush();
      }
    },
    [display, displaySender],
  );

  const clearDisplay = useCallback(async () => {
    displaySender.cancel();
    if (!display.available) {
      setNotice({ tone: 'info', message: display.message });
      return;
    }
    try {
      await BluetoothSdk.clearDisplay();
      appendLog('app', 'Display cleared.');
    } catch (error) {
      const message = `Could not clear the display: ${formatError(error)}`;
      appendLog('error', message);
      setNotice({ tone: 'danger', message });
    }
  }, [appendLog, display, displaySender]);

  return {
    glasses,
    connectedModel,
    savedDevice,
    scan: {
      model: scanModel,
      active: mentra.scan.active,
      devices: mentra.scan.devices,
      selected: mentra.scan.selectedDevice,
      startedAt: scanStartedAt,
      timeoutMs: SCAN_TIMEOUT_MS,
      hint: mentra.scan.diagnostic?.message ?? null,
      lastResultCount,
    },
    busy,
    notice,
    display,
    inputEvents,
    log,
    selectScanModel,
    startScan,
    stopScan,
    selectDevice,
    connectSelected,
    reconnectSaved,
    cancelConnecting,
    disconnect,
    forgetSaved,
    showText,
    clearDisplay,
    dismissNotice: () => setNotice(null),
    openSettings: () => void Linking.openSettings(),
    clearInputEvents: () => setInputEvents([]),
    clearLog: () => setLog([]),
  };
}
