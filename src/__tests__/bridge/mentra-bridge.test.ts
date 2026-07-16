jest.mock('@mentra/sdk', () => ({
  AppServer: class {},
  AppSession: class {},
}));

// `answer` is the memory-backed brain and is stubbed, but the real
// `parseRememberCommand` / `resolveDefaultModel` are kept: the gate is only
// honest if it is tested against the regex that actually ships.
jest.mock('../../agent/answer-service', () => ({
  ...jest.requireActual('../../agent/answer-service'),
  answer: jest.fn(),
}));

jest.mock('../../memory/companion-memory', () => ({
  recall: jest.fn(),
  writeMemory: jest.fn(),
  writeTurn: jest.fn(),
  getContext: jest.fn(),
}));

jest.mock('../../providers', () => ({ resolveProvider: jest.fn() }));
jest.mock('../../voice/stt', () => ({ transcribeAudio: jest.fn() }));

import { readFileSync } from 'fs';
import { join } from 'path';
import type { AppSession, ToolCall } from '@mentra/sdk';
import {
  selectBridgeLayout,
  truncateForGlass,
  capturePhotoToMemory,
  memoryAllowed,
  plainAnswer,
  MentraBridge,
  SettingKey,
} from '../../bridge/mentra-bridge';
import { resetToolState, TAKE_PHOTO_SENTINEL } from '../../mentra/tools';
import * as memory from '../../memory/companion-memory';
import * as answerService from '../../agent/answer-service';
import * as sessionHistory from '../../agent/session-history';
import { resolveProvider } from '../../providers';
import { transcribeAudio } from '../../voice/stt';

const mockedMemory = memory as jest.Mocked<typeof memory>;
const mockedAnswer = answerService.answer as jest.Mock;
const mockedResolveProvider = resolveProvider as jest.Mock;
const mockedTranscribe = transcribeAudio as jest.Mock;

interface ManifestSetting {
  type: string;
  key: string;
  label?: string;
  defaultValue?: unknown;
}

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../../app_config.json'), 'utf8')
) as { settings: ManifestSetting[] };

describe('Mentra bridge layout helpers', () => {
  it('uses a dashboard card when there is no active conversation text', () => {
    expect(selectBridgeLayout(undefined, undefined, 'Listening...')).toEqual({
      type: 'dashboard',
      leftText: 'Mentra Bridge',
      rightText: 'Listening...',
    });
  });

  it('uses a text wall for user-only transcript updates', () => {
    expect(selectBridgeLayout('hello there')).toEqual({
      type: 'text',
      text: 'You: hello there',
    });
  });

  it('uses a reference card for assistant-only content', () => {
    expect(selectBridgeLayout(undefined, 'A concise answer')).toEqual({
      type: 'reference',
      title: 'Assistant',
      text: 'A concise answer',
    });
  });

  it('uses a double text wall when both transcript and response are present', () => {
    expect(selectBridgeLayout('What time is it?', 'It is 3 PM.')).toEqual({
      type: 'double',
      topText: 'You: What time is it?',
      bottomText: 'Assistant: It is 3 PM.',
    });
  });

  it('truncates glass text safely', () => {
    expect(truncateForGlass('  abc   def  ', 6)).toBe('abc d…');
  });
});

interface FakeSessionOptions {
  hasCamera?: boolean;
  hasLight?: boolean;
  hasMicrophone?: boolean;
  sessionId?: string;
  settings?: Record<string, unknown>;
  settingsThrows?: boolean;
  requestPhoto?: jest.Mock;
}

/**
 * A session whose settings store behaves like the SDK's:
 * `get<T>(key, defaultValue?)` returns the default for a key the cloud has not
 * pushed, which is exactly the state a real session starts in.
 */
function fakeSession(options: FakeSessionOptions = {}) {
  const {
    hasCamera = true,
    hasLight = true,
    hasMicrophone = true,
    sessionId = 'live-session',
    settingsThrows = false,
    settings = { camera_capture_enabled: true, memory_enabled: true },
    requestPhoto = jest.fn().mockResolvedValue({
      buffer: Buffer.from('jpegbytes'),
      mimeType: 'image/jpeg',
      filename: 'IMG_0001.jpg',
      requestId: 'req-1',
      size: 9,
      timestamp: new Date('2026-07-16T12:00:00.000Z'),
    }),
  } = options;

  const handlers: Record<string, (...args: any[]) => unknown> = {};
  const speak = jest.fn().mockResolvedValue({ success: true });
  const led = { solid: jest.fn().mockResolvedValue(undefined), turnOff: jest.fn().mockResolvedValue(undefined) };

  const session = {
    capabilities: { hasCamera, hasLight, hasMicrophone, hasDisplay: true },
    settings: {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (settingsThrows) throw new Error('settings not ready');
        return key in settings ? settings[key] : fallback;
      }),
    },
    events: {
      onCapabilitiesUpdate: jest.fn((h) => { handlers.capabilities = h; }),
      onVoiceActivity: jest.fn((h) => { handlers.vad = h; }),
      onAudioChunk: jest.fn((h) => { handlers.audio = h; }),
      onTranscription: jest.fn((h) => { handlers.transcription = h; }),
      onCalendarEvent: jest.fn((h) => { handlers.calendar = h; }),
      onButtonPress: jest.fn((h) => { handlers.button = h; }),
      on: jest.fn((event: string, h) => { handlers[event] = h; }),
    },
    dashboard: { content: { write: jest.fn() } },
    layouts: {
      showDoubleTextWall: jest.fn(),
      showReferenceCard: jest.fn(),
      showTextWall: jest.fn(),
      showDashboardCard: jest.fn(),
      clearView: jest.fn(),
    },
    audio: { speak, stopAudio: jest.fn() },
    led,
    camera: { requestPhoto },
    getSessionId: jest.fn(() => sessionId),
  };

  return { session, asAppSession: session as unknown as AppSession, handlers, requestPhoto, speak, led };
}

/** Exposes the protected SDK hooks so the bridge wiring can be driven directly. */
class TestBridge extends MentraBridge {
  public invokeToolCall(toolCall: ToolCall): Promise<string | undefined> {
    return this.onToolCall(toolCall);
  }
  public invokeSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    return this.onSession(session, sessionId, userId);
  }
  public invokeStop(sessionId: string, userId: string, reason: string): Promise<void> {
    return this.onStop(sessionId, userId, reason);
  }
}

function toolCall(overrides: Partial<ToolCall> & { toolId: string }): ToolCall {
  return {
    toolParameters: {},
    timestamp: new Date('2026-07-16T12:00:00.000Z'),
    userId: 'user-1',
    activeSession: null,
    ...overrides,
  } as ToolCall;
}

/** Let the async voice pipeline settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** 16kHz mono Int16 => 32 bytes per ms. */
const audioMs = (ms: number): Buffer => Buffer.alloc(ms * 32);

/**
 * Sessions started by a test hold real timers (VadBuffer's safety timer, the LED
 * heartbeat). `onStop` is the only thing that releases them, so run it — which
 * also keeps every test honest about the teardown registry actually draining.
 */
const startedSessions: Array<() => Promise<void>> = [];

async function startSession(options: FakeSessionOptions = {}, sessionId = 'sess-1') {
  const bridge = new TestBridge();
  const fake = fakeSession(options);
  await bridge.invokeSession(fake.asAppSession, sessionId, 'user-1');
  startedSessions.push(() => bridge.invokeStop(sessionId, 'user-1', 'test teardown'));
  return { bridge, ...fake };
}

afterEach(async () => {
  while (startedSessions.length) {
    await startedSessions.pop()?.();
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  resetToolState();
  sessionHistory.resetSessions();
  mockedMemory.writeMemory.mockResolvedValue(true);
  mockedMemory.recall.mockResolvedValue({ block: '', resultCount: 0 });
  mockedMemory.writeTurn.mockResolvedValue(undefined);
  mockedMemory.getContext.mockResolvedValue('');
  mockedTranscribe.mockResolvedValue('what is my gate code');
  mockedAnswer.mockResolvedValue({
    answer: 'A remembered answer.',
    remembered: false,
    usedRecallCount: 2,
    usedContext: true,
  });
  mockedResolveProvider.mockReturnValue({
    chatCompletion: jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'A plain reply.' } }],
    }),
  });
});

/**
 * Finding A's contract, stated once: nothing in the manifest may be decorative.
 * A settings screen that advertises control it does not have is the one bug a
 * privacy device cannot ship.
 */
describe('app_config.json settings are all real', () => {
  const wearerSettings = manifest.settings.filter((s) => s.type !== 'group');

  it('reads every setting the manifest advertises', () => {
    expect(wearerSettings.map((s) => s.key).sort()).toEqual(Object.values(SettingKey).sort());
  });

  it('advertises no setting the bridge cannot honour', () => {
    for (const setting of wearerSettings) {
      expect(Object.values(SettingKey)).toContain(setting.key);
    }
  });

  it('keeps memory opt-in by default', () => {
    const memorySetting = wearerSettings.find((s) => s.key === SettingKey.MemoryEnabled);
    expect(memorySetting?.defaultValue).toBe(false);
  });
});

describe('memoryAllowed', () => {
  it('is true only when the wearer has switched it on', () => {
    expect(memoryAllowed(fakeSession({ settings: { memory_enabled: true } }).asAppSession)).toBe(true);
  });

  it('fails closed when the wearer has not opted in', () => {
    expect(memoryAllowed(fakeSession({ settings: { memory_enabled: false } }).asAppSession)).toBe(false);
  });

  it('fails closed when the cloud has not pushed settings yet', () => {
    // `get` returns the caller's default for an unknown key — here, off.
    expect(memoryAllowed(fakeSession({ settings: {} }).asAppSession)).toBe(false);
  });

  it('fails closed when the settings store throws', () => {
    expect(memoryAllowed(fakeSession({ settingsThrows: true }).asAppSession)).toBe(false);
  });

  it('fails closed when there is no session at all', () => {
    expect(memoryAllowed(null)).toBe(false);
    expect(memoryAllowed(undefined)).toBe(false);
  });
});

describe('plainAnswer (the memory-off path)', () => {
  it('replies without recalling or persisting anything', async () => {
    const result = await plainAnswer({ sessionId: 's1', userId: 'u1', text: 'what is the capital of France' });

    expect(result.answer).toBe('A plain reply.');
    expect(result.usedRecallCount).toBe(0);
    expect(result.usedContext).toBe(false);
    expect(mockedMemory.recall).not.toHaveBeenCalled();
    expect(mockedMemory.getContext).not.toHaveBeenCalled();
    expect(mockedMemory.writeTurn).not.toHaveBeenCalled();
    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
  });

  it('tells the truth instead of promising to remember', async () => {
    const result = await plainAnswer({ sessionId: 's1', userId: 'u1', text: 'remember that my gate code is 4821' });

    expect(result.remembered).toBe(false);
    expect(result.answer).toMatch(/memory is turned off/i);
    expect(result.answer).toMatch(/Remember our conversations/);
    // Crucially it never reaches a model that would say "sure, I'll remember".
    expect(mockedResolveProvider).not.toHaveBeenCalled();
    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
  });

  it('keeps in-session context so follow-ups still work', async () => {
    await plainAnswer({ sessionId: 's1', userId: 'u1', text: 'my favourite colour is teal' });
    await plainAnswer({ sessionId: 's1', userId: 'u1', text: 'what did I just say' });

    const [turn] = mockedResolveProvider.mock.calls[1];
    const contents = turn.input_messages.map((m: { content: unknown }) => m.content);
    expect(contents).toContain('my favourite colour is teal');
    // ...but that context is process-local and dies with the session.
    sessionHistory.clearSession('s1');
    expect(sessionHistory.getHistory('s1')).toEqual([]);
  });

  it('stays speakable when the provider is unreachable', async () => {
    mockedResolveProvider.mockReturnValue({
      chatCompletion: jest.fn().mockRejectedValue(new Error('ollama down')),
    });

    const result = await plainAnswer({ sessionId: 's1', userId: 'u1', text: 'hello' });

    expect(result.answer).toMatch(/couldn't reach the assistant/i);
  });
});

describe('the voice loop honours the wearer settings', () => {
  /** Drive one complete utterance through VAD -> STT -> answer -> TTS. */
  async function speakOneUtterance(options: FakeSessionOptions = {}) {
    const started = await startSession(options);

    started.handlers.vad({ status: true });
    started.handlers.audio({ arrayBuffer: audioMs(500), sampleRate: 16000 });
    started.handlers.vad({ status: false });
    await flush();

    return started;
  }

  it('uses the memory brain when the wearer has opted in', async () => {
    const { speak } = await speakOneUtterance({ settings: { memory_enabled: true } });

    expect(mockedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', text: 'what is my gate code' })
    );
    expect(speak).toHaveBeenCalledWith('A remembered answer.', undefined);
  });

  it('never recalls or persists when the wearer has memory off', async () => {
    const { speak } = await speakOneUtterance({ settings: { memory_enabled: false } });

    // The env may have memory enabled server-side; the wearer's switch still wins.
    expect(mockedAnswer).not.toHaveBeenCalled();
    expect(mockedMemory.recall).not.toHaveBeenCalled();
    expect(mockedMemory.getContext).not.toHaveBeenCalled();
    expect(mockedMemory.writeTurn).not.toHaveBeenCalled();
    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledWith('A plain reply.', undefined);
  });

  it('treats settings the cloud has not pushed yet as memory off', async () => {
    await speakOneUtterance({ settings: {} });

    expect(mockedAnswer).not.toHaveBeenCalled();
    expect(mockedMemory.writeTurn).not.toHaveBeenCalled();
  });

  it('shows the answer but stays silent when speak_answers is off', async () => {
    const { speak, session } = await speakOneUtterance({
      settings: { memory_enabled: true, speak_answers: false },
    });

    expect(speak).not.toHaveBeenCalled();
    // The wearer still gets the answer — on the display.
    expect(session.layouts.showDoubleTextWall).toHaveBeenCalledWith(
      'You: what is my gate code',
      'Assistant: A remembered answer.'
    );
  });

  it('speaks in the wearer chosen voice', async () => {
    const { speak } = await speakOneUtterance({
      settings: { memory_enabled: true, assistant_voice_id: '  voice-abc  ' },
    });

    expect(speak).toHaveBeenCalledWith('A remembered answer.', { voice_id: 'voice-abc' });
  });

  it('leaves the voice to the server default when the field is blank', async () => {
    const { speak } = await speakOneUtterance({
      settings: { memory_enabled: true, assistant_voice_id: '   ' },
    });

    expect(speak).toHaveBeenCalledWith('A remembered answer.', undefined);
  });

  it('transcribes in the language the wearer says they speak', async () => {
    await speakOneUtterance({ settings: { memory_enabled: true, transcribe_language: 'es' } });

    expect(mockedTranscribe).toHaveBeenCalledWith(expect.any(Buffer), { language: 'es' });
  });

  it('lets the engine auto-detect when the language is left on the default', async () => {
    await speakOneUtterance({ settings: { memory_enabled: true, transcribe_language: '' } });

    expect(mockedTranscribe).toHaveBeenCalledWith(expect.any(Buffer), { language: undefined });
  });

  it('keeps the voice loop alive when the settings store is broken', async () => {
    const { speak } = await speakOneUtterance({ settingsThrows: true });

    // Unreadable settings must degrade to defaults, not throw: memory off, still speaking.
    expect(mockedAnswer).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledWith('A plain reply.', undefined);
  });
});

describe('the privacy LED tracks the microphone, not the request', () => {
  const startedSession = (options: FakeSessionOptions = {}) =>
    startSession({ settings: { memory_enabled: true }, ...options });

  it('lights up while capturing and goes out when capture ends', async () => {
    const { handlers, led } = await startedSession();

    handlers.vad({ status: true });
    expect(led.solid).toHaveBeenCalledWith('red', 15000);

    handlers.audio({ arrayBuffer: audioMs(500), sampleRate: 16000 });
    handlers.vad({ status: false });
    await flush();

    expect(led.turnOff).toHaveBeenCalled();
  });

  it('stays lit when a long utterance force-flushes mid-capture', async () => {
    const { handlers, led } = await startedSession();

    handlers.vad({ status: true });
    // VadBuffer force-flushes at maxDurationMs (10s) and *keeps capturing*.
    handlers.audio({ arrayBuffer: audioMs(11000), sampleRate: 16000 });
    await flush();

    // The utterance was emitted and processed...
    expect(mockedTranscribe).toHaveBeenCalled();
    // ...but VAD never said the mic closed, so the light must not have lied.
    expect(led.turnOff).not.toHaveBeenCalled();

    handlers.vad({ status: false });
    await flush();
    expect(led.turnOff).toHaveBeenCalled();
  });

  it('re-arms the light so a capture outlasting the LED cap cannot go dark', async () => {
    jest.useFakeTimers();
    try {
      const { handlers, led } = await startedSession();

      handlers.vad({ status: true });
      expect(led.solid).toHaveBeenCalledTimes(1);

      // `led.solid` only holds for PRIVACY_LED_MAX_MS, so a still-open mic needs re-arming.
      jest.advanceTimersByTime(10000);
      expect(led.solid).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(10000);
      expect(led.solid).toHaveBeenCalledTimes(3);
      expect(led.turnOff).not.toHaveBeenCalled();

      handlers.vad({ status: false });
      expect(led.turnOff).toHaveBeenCalled();

      // ...and the heartbeat stops once the mic closes.
      jest.advanceTimersByTime(30000);
      expect(led.solid).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('goes out on disconnect without tearing the session down', async () => {
    const { handlers, led, session } = await startedSession();

    handlers.vad({ status: true });
    handlers.disconnected();

    expect(led.turnOff).toHaveBeenCalled();
    expect(session.layouts.clearView).toHaveBeenCalled();
  });

  it('skips the light entirely on glasses that have none', async () => {
    const { handlers, led } = await startedSession({ hasLight: false });

    handlers.vad({ status: true });
    handlers.vad({ status: false });
    await flush();

    expect(led.solid).not.toHaveBeenCalled();
    expect(led.turnOff).not.toHaveBeenCalled();
  });
});

describe('capturePhotoToMemory', () => {
  it('captures a photo and writes a memory fragment describing the capture', async () => {
    const { asAppSession, requestPhoto } = fakeSession();

    const result = await capturePhotoToMemory(asAppSession, 's1', 'my parking spot');

    expect(requestPhoto).toHaveBeenCalledWith({ saveToGallery: true });
    expect(mockedMemory.writeMemory).toHaveBeenCalledTimes(1);
    const [fragment, opts] = mockedMemory.writeMemory.mock.calls[0];
    expect(fragment).toContain('my parking spot');
    expect(fragment).toContain('IMG_0001.jpg');
    expect(fragment).toContain('2026-07-16T12:00:00.000Z');
    expect(opts).toEqual(expect.objectContaining({ sessionId: 's1', title: 'my parking spot' }));
    expect(result).toMatch(/saved a photo/i);
  });

  it('refuses when the device has no camera, without touching memory', async () => {
    const { asAppSession, requestPhoto } = fakeSession({ hasCamera: false });

    const result = await capturePhotoToMemory(asAppSession, 's1');

    expect(requestPhoto).not.toHaveBeenCalled();
    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
    expect(result).toMatch(/don't have a camera/i);
  });

  it('respects the opt-in setting being off', async () => {
    const { asAppSession, requestPhoto } = fakeSession({
      settings: { camera_capture_enabled: false, memory_enabled: true },
    });

    const result = await capturePhotoToMemory(asAppSession, 's1');

    expect(requestPhoto).not.toHaveBeenCalled();
    expect(result).toMatch(/turned off/i);
  });

  it('never opens the shutter when memory is off — there is nothing honest to do with the frame', async () => {
    const { asAppSession, requestPhoto } = fakeSession({
      settings: { camera_capture_enabled: true, memory_enabled: false },
    });

    const result = await capturePhotoToMemory(asAppSession, 's1');

    expect(requestPhoto).not.toHaveBeenCalled();
    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
    expect(result).toMatch(/memory is turned off/i);
  });

  it('treats an unreadable settings store as opt-out rather than throwing', async () => {
    const { asAppSession, requestPhoto } = fakeSession({ settingsThrows: true });

    const result = await capturePhotoToMemory(asAppSession, 's1');

    expect(requestPhoto).not.toHaveBeenCalled();
    expect(result).toMatch(/turned off/i);
  });

  it('degrades gracefully when the capture itself fails', async () => {
    const { asAppSession } = fakeSession({
      requestPhoto: jest.fn().mockRejectedValue(new Error('shutter timeout')),
    });

    const result = await capturePhotoToMemory(asAppSession, 's1');

    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
    expect(result).toMatch(/couldn't take a photo/i);
  });
});

describe('MentraBridge.onToolCall', () => {
  it('delegates a memory tool to the shared handler', async () => {
    const bridge = new TestBridge();
    const { asAppSession } = fakeSession({ sessionId: 'live-session' });

    const result = await bridge.invokeToolCall(
      toolCall({
        toolId: 'remember_this',
        toolParameters: { content: 'the gate code is 4821' },
        activeSession: asAppSession,
      })
    );

    expect(mockedMemory.writeMemory).toHaveBeenCalledWith(
      'the gate code is 4821',
      expect.objectContaining({ sessionId: 'live-session' })
    );
    expect(result).toMatch(/remember/i);
  });

  it('keys memory on the live session id when the glasses are connected', async () => {
    const bridge = new TestBridge();
    const { asAppSession } = fakeSession({ sessionId: 'live-session' });

    await bridge.invokeToolCall(
      toolCall({ toolId: 'remember_this', toolParameters: { content: 'note' }, activeSession: asAppSession })
    );

    expect(mockedMemory.writeMemory).toHaveBeenCalledWith(
      'note',
      expect.objectContaining({ sessionId: 'live-session' })
    );
  });

  it('falls back to userId rather than keying memory on the unknown-session sentinel', async () => {
    const bridge = new TestBridge();
    const { asAppSession } = fakeSession({ sessionId: 'unknown-session-id' });

    await bridge.invokeToolCall(
      toolCall({ toolId: 'remember_this', toolParameters: { content: 'note' }, activeSession: asAppSession })
    );

    expect(mockedMemory.writeMemory).toHaveBeenCalledWith(
      'note',
      expect.objectContaining({ sessionId: 'user-1' })
    );
  });

  it('refuses to write through the tool path when the wearer has memory off', async () => {
    const bridge = new TestBridge();
    const { asAppSession } = fakeSession({ settings: { memory_enabled: false } });

    const result = await bridge.invokeToolCall(
      toolCall({ toolId: 'remember_this', toolParameters: { content: 'secret' }, activeSession: asAppSession })
    );

    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
    expect(result).toMatch(/memory is turned off/i);
  });

  it('refuses to search through the tool path when the wearer has memory off', async () => {
    const bridge = new TestBridge();
    const { asAppSession } = fakeSession({ settings: { memory_enabled: false } });

    const result = await bridge.invokeToolCall(
      toolCall({ toolId: 'search_memory', toolParameters: { query: 'gate code' }, activeSession: asAppSession })
    );

    expect(mockedMemory.recall).not.toHaveBeenCalled();
    expect(result).toMatch(/memory is turned off/i);
  });

  it('fails closed on a tool call with no session to check the setting against', async () => {
    const bridge = new TestBridge();

    const result = await bridge.invokeToolCall(
      toolCall({ toolId: 'remember_this', toolParameters: { content: 'secret' }, activeSession: null })
    );

    // Without a session there is no way to know the wearer opted in, and
    // `memory_enabled` defaults to false — so this must not write.
    expect(mockedMemory.writeMemory).not.toHaveBeenCalled();
    expect(result).toMatch(/memory is turned off/i);
  });

  it('resolves the take_photo sentinel into a real capture', async () => {
    const bridge = new TestBridge();
    const { asAppSession, requestPhoto } = fakeSession();

    const result = await bridge.invokeToolCall(
      toolCall({ toolId: 'take_photo', toolParameters: { note: 'the whiteboard' }, activeSession: asAppSession })
    );

    expect(requestPhoto).toHaveBeenCalledWith({ saveToGallery: true });
    expect(result).not.toContain(TAKE_PHOTO_SENTINEL);
    expect(result).toMatch(/saved a photo/i);
  });

  it('never leaks the sentinel to the wearer when no session is attached', async () => {
    const bridge = new TestBridge();

    const result = await bridge.invokeToolCall(toolCall({ toolId: 'take_photo', activeSession: null }));

    expect(result).not.toContain(TAKE_PHOTO_SENTINEL);
    expect(result).toMatch(/glasses are connected/i);
  });

  it('answers a calendar tool without needing memory', async () => {
    const bridge = new TestBridge();
    const { asAppSession } = fakeSession({ settings: { memory_enabled: false } });

    const result = await bridge.invokeToolCall(
      toolCall({ toolId: 'whats_on_my_calendar', activeSession: asAppSession })
    );

    expect(result).toMatch(/don't have any upcoming/i);
  });

  it('answers with a spoken apology instead of throwing', async () => {
    const bridge = new TestBridge();
    const { asAppSession } = fakeSession();
    mockedMemory.writeMemory.mockRejectedValue(new Error('memory exploded'));

    const result = await bridge.invokeToolCall(
      toolCall({ toolId: 'remember_this', toolParameters: { content: 'x' }, activeSession: asAppSession })
    );

    expect(result).toMatch(/something went wrong/i);
  });
});
