import { AppServer, AppSession } from '@mentra/sdk';
import type { Capabilities, LedColor, SpeakOptions, ToolCall } from '@mentra/sdk';
import { config } from '../config';
import { VadBuffer, UtteranceSegment } from '../voice/vad-buffer';
import { transcribeAudio } from '../voice/stt';
import { answer, parseRememberCommand, resolveDefaultModel } from '../agent/answer-service';
import type { AnswerResult } from '../agent/answer-service';
import * as sessionHistory from '../agent/session-history';
import * as companionMemory from '../memory/companion-memory';
import { resolveProvider } from '../providers';
import { normalizeChatCompletionToCanonical } from '../canonical/normalizer';
import {
  handleToolCall,
  isTakePhotoSentinel,
  takePhotoNote,
  recordCalendarEvent,
  clearCalendarEvents,
  ToolId,
} from '../mentra/tools';
import pino from 'pino';

const logger = pino({ name: 'mentra-bridge' });
const GLASS_TEXT_LIMIT = 280;
const TRANSCRIPTION_UI_DEBOUNCE_MS = 250;

/**
 * The wearer-facing settings declared in `app_config.json`.
 *
 * Every key here is read at runtime; conversely nothing may sit in that manifest
 * without a reader here. A toggle that does not govern behaviour is worse than a
 * missing feature — it is a promise the app does not keep.
 */
export const SettingKey = {
  MemoryEnabled: 'memory_enabled',
  SpeakAnswers: 'speak_answers',
  AssistantVoiceId: 'assistant_voice_id',
  TranscribeLanguage: 'transcribe_language',
  CameraCaptureEnabled: 'camera_capture_enabled',
} as const;

/** Red is the conventional "this device is capturing" indicator. */
const PRIVACY_LED_COLOR: LedColor = 'red';
/**
 * `led.solid()` takes a hard duration, so the light cannot simply be left on:
 * it must be re-armed while the mic is open (see `startPrivacyIndicator`).
 */
const PRIVACY_LED_MAX_MS = 15000;
/** Comfortably inside `PRIVACY_LED_MAX_MS`, so a re-arm always lands first. */
const PRIVACY_LED_REFRESH_MS = 10000;

/** Said aloud, so it names the exact control the wearer has to go and flip. */
const MEMORY_OFF_WRITE_REPLY =
  "Memory is turned off, so I can't save that. You can turn on \"Remember our conversations\" in the Companion settings.";
const MEMORY_OFF_SEARCH_REPLY =
  'Memory is turned off, so there\'s nothing for me to search. You can turn on "Remember our conversations" in the Companion settings.';

/** What `AppSession.getSessionId()` returns when the session isn't connected. */
const UNKNOWN_SESSION_ID = 'unknown-session-id';

export type BridgeLayout =
  | { type: 'dashboard'; leftText: string; rightText: string }
  | { type: 'text'; text: string }
  | { type: 'reference'; title: string; text: string }
  | { type: 'double'; topText: string; bottomText: string };

export function truncateForGlass(text: string, maxLength = GLASS_TEXT_LIMIT): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function selectBridgeLayout(
  transcript?: string,
  response?: string,
  status = 'Listening...'
): BridgeLayout {
  const trimmedTranscript = transcript?.trim();
  const trimmedResponse = response?.trim();

  if (trimmedTranscript && trimmedResponse) {
    return {
      type: 'double',
      topText: truncateForGlass(`You: ${trimmedTranscript}`),
      bottomText: truncateForGlass(`Assistant: ${trimmedResponse}`),
    };
  }

  if (trimmedResponse) {
    return {
      type: 'reference',
      title: 'Assistant',
      text: truncateForGlass(trimmedResponse),
    };
  }

  if (trimmedTranscript) {
    return {
      type: 'text',
      text: truncateForGlass(`You: ${trimmedTranscript}`),
    };
  }

  return {
    type: 'dashboard',
    leftText: 'Mentra Bridge',
    rightText: truncateForGlass(status, 80),
  };
}

function hasDisplay(capabilities: Capabilities | null): boolean {
  return capabilities?.hasDisplay ?? true;
}

function hasMicrophone(capabilities: Capabilities | null): boolean {
  return capabilities?.hasMicrophone ?? true;
}

/**
 * Read one wearer setting, defensively.
 *
 * `SettingsManager.get<T>(key, defaultValue?)` returns the default when the key
 * is absent — but `settings` is only populated once the cloud pushes it, and on
 * a tool call there may be no live session at all. Any of that must degrade to
 * the default rather than take down the voice loop.
 */
function readSetting<T>(session: AppSession | null | undefined, key: string, fallback: T): T {
  try {
    const value = session?.settings?.get<T>(key, fallback);
    return value === undefined || value === null ? fallback : value;
  } catch (err) {
    logger.debug({ err: (err as Error).message, key }, 'setting unavailable, using default');
    return fallback;
  }
}

/**
 * Whether this wearer has opted in to long-term memory.
 *
 * Fails **closed**: an absent session, settings the cloud has not pushed yet, or
 * a settings store that throws all read as "off". `memory_enabled` defaults to
 * false in the manifest, so closed is also the honest default — the app must
 * never store or recall a person's life because a lookup happened to fail.
 *
 * Note this is the *wearer's* switch, deliberately independent of the server's
 * `MENTRA_MEMORY_ENABLED` env. The env says whether the appliance can do memory
 * at all; this says whether this person wants it. Both must be true, and
 * `companion-memory` already enforces its own side.
 */
export function memoryAllowed(session: AppSession | null | undefined): boolean {
  return readSetting<boolean>(session, SettingKey.MemoryEnabled, false) === true;
}

/**
 * Camera capture is opt-in and double-gated: the wearer's `camera_capture_enabled`
 * setting AND the device actually having a camera.
 */
function cameraCaptureAllowed(session: AppSession): boolean {
  if (!session.capabilities?.hasCamera) return false;
  return readSetting<boolean>(session, SettingKey.CameraCaptureEnabled, false) === true;
}

/**
 * Whether to read replies aloud. Unlike memory this fails **open** — the manifest
 * default is true and staying silent is a broken assistant, not a privacy save —
 * so only an explicit `false` mutes it.
 */
function speakAnswersAllowed(session: AppSession | null | undefined): boolean {
  return readSetting<boolean>(session, SettingKey.SpeakAnswers, true) !== false;
}

/** The wearer's chosen voice, or undefined to let the server pick its default. */
function speakOptions(session: AppSession | null | undefined): SpeakOptions | undefined {
  const raw = readSetting<unknown>(session, SettingKey.AssistantVoiceId, '');
  const voiceId = typeof raw === 'string' ? raw.trim() : '';
  return voiceId ? { voice_id: voiceId } : undefined;
}

/** The wearer's spoken language, or undefined to let the STT engine detect it. */
function transcribeLanguage(session: AppSession | null | undefined): string | undefined {
  const raw = readSetting<unknown>(session, SettingKey.TranscribeLanguage, '');
  const language = typeof raw === 'string' ? raw.trim() : '';
  return language || undefined;
}

/**
 * The reply path used when the wearer's `memory_enabled` toggle is off.
 *
 * `answer()` unconditionally recalls long-term memory and writes the turn back,
 * and it reads its persona and recall depth from the shared global `config` —
 * which the companion web UI's BFF shares too, so the bridge cannot express one
 * wearer's preference by mutating it. Rather than thread a flag through a module
 * another surface depends on (and that another agent owns), the bridge simply
 * does not call it: this path composes a reply from the persona and the
 * in-session history alone. Nothing is read from, or written to, the appliance.
 *
 * Rolling session history stays. It lives in this process for the life of the
 * session and dies with it in `onStop`, so it is not "remembering our
 * conversations" in the sense the toggle promises — it is only what makes a
 * follow-up question work.
 */
export async function plainAnswer(input: {
  sessionId: string;
  userId: string;
  text: string;
}): Promise<AnswerResult> {
  const text = input.text.trim();
  if (!text) return { answer: '', remembered: false, usedRecallCount: 0, usedContext: false };

  // "Remember this…" with memory off must not reach a model that will cheerfully
  // promise to remember it. Say the true thing instead.
  if (parseRememberCommand(text)) {
    sessionHistory.appendExchange(input.sessionId, text, MEMORY_OFF_WRITE_REPLY);
    return { answer: MEMORY_OFF_WRITE_REPLY, remembered: false, usedRecallCount: 0, usedContext: false };
  }

  const priorHistory = sessionHistory.getHistory(input.sessionId).map((m) => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  const turn = normalizeChatCompletionToCanonical(
    {
      model: resolveDefaultModel(),
      messages: [
        { role: 'system', content: config.agent.persona },
        ...priorHistory,
        { role: 'user', content: text },
      ],
      stream: false,
    },
    'mentra-companion',
    input.userId
  );
  turn.conversation_id = input.sessionId;

  let answerText = '';
  try {
    const provider = resolveProvider(turn);
    const result = await provider.chatCompletion(turn);
    answerText = result.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    logger.error({ err: (err as Error).message, sessionId: input.sessionId }, 'memory-free answer failed');
  }
  if (!answerText) answerText = "Sorry, I couldn't reach the assistant just now. Please try again.";

  sessionHistory.appendExchange(input.sessionId, text, answerText);
  return { answer: answerText, remembered: false, usedRecallCount: 0, usedContext: false };
}

/**
 * Capture a photo and record a memory fragment describing it.
 *
 * We deliberately describe the *capture* (when, what the wearer said about it)
 * rather than the image contents: there is no on-device vision model here, so
 * claiming to know what is in the frame would be a lie. The fragment makes the
 * moment findable later via recall; the image itself stays on the device
 * gallery. Exported so both the voice loop and `onToolCall` share one path.
 */
export async function capturePhotoToMemory(
  session: AppSession,
  sessionId: string,
  note = ''
): Promise<string> {
  if (!session.capabilities?.hasCamera) {
    return "These glasses don't have a camera.";
  }
  if (!cameraCaptureAllowed(session)) {
    return 'Photo capture is turned off. You can enable it in the Companion settings.';
  }
  // This tool exists to *save a memory*. With memory off there is nothing honest
  // to do with the frame, so don't open the shutter at all.
  if (!memoryAllowed(session)) {
    return MEMORY_OFF_WRITE_REPLY;
  }

  try {
    const photo = await session.camera.requestPhoto({ saveToGallery: true });
    const captured = photo.timestamp instanceof Date ? photo.timestamp : new Date();
    const description = note
      ? `Took a photo through my glasses: ${note}.`
      : 'Took a photo through my glasses.';
    const fragment = [
      description,
      `Captured ${captured.toISOString()} (${photo.filename}, ${photo.mimeType}, ${photo.size} bytes).`,
    ].join('\n');

    await companionMemory.writeMemory(fragment, { title: note || 'Photo capture', sessionId });
    logger.info({ sessionId, requestId: photo.requestId, size: photo.size }, 'Photo captured to memory');
    return note ? `Got it — I saved a photo of ${note}.` : "Got it — I've saved that photo to your memory.";
  } catch (err) {
    logger.error({ err: (err as Error).message, sessionId }, 'Photo capture failed');
    return "Sorry, I couldn't take a photo just now.";
  }
}

/**
 * MentraBridge is the MentraOS AppServer that:
 * 1. Receives session webhooks from MentraOS Cloud
 * 2. Subscribes to audio (VAD + AudioChunk) or transcription events
 * 3. Routes voice input through the STT → Companion answer → TTS pipeline
 * 4. Plays the response back on the glasses
 *
 * The answer step is the shared `answerService`, so the glasses get long-term
 * Companion Memory, rolling session history and "remember this" for free —
 * exactly the same brain the companion web UI talks to.
 */
export class MentraBridge extends AppServer {
  /**
   * Per-session teardown, invoked from `onStop` — the only signal that a session
   * has actually ended. It cannot live in the `disconnected` handler: the SDK
   * reconnects automatically (`autoReconnect` defaults to true, 3 attempts), so
   * `disconnected` also fires on a transient WebSocket blip. Tearing down there
   * would permanently deafen the glasses and wipe the wearer's short-term memory
   * for a drop the SDK is about to heal.
   */
  private readonly teardowns = new Map<string, () => void>();

  constructor() {
    super({
      packageName: config.mentra.packageName,
      apiKey: config.mentra.apiKey,
      port: config.mentra.port,
      cloudApiUrl: config.mentra.cloudApiUrl,
      healthCheck: true,
    });
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    logger.info({ sessionId, userId }, 'New Mentra session started');

    let lastTranscript = '';
    let lastAssistantResponse = '';
    let statusText = 'Listening...';
    let lastTranscriptionUiUpdateAt = 0;
    /** Mirrors the mic: set from VAD only, never from the processing pipeline. */
    let capturing = false;
    let ledRefresh: ReturnType<typeof setInterval> | null = null;

    const vadBuffer = new VadBuffer({
      maxDurationMs: 10000,
      sampleRate: 16000,
    });

    const clearPrivacyRefresh = (): void => {
      if (ledRefresh) {
        clearInterval(ledRefresh);
        ledRefresh = null;
      }
    };

    // Registered here, run only from onStop (see `teardowns`).
    this.teardowns.set(sessionId, () => {
      sessionHistory.clearSession(sessionId);
      clearCalendarEvents(sessionId);
      clearPrivacyRefresh();
      vadBuffer.destroy();
    });

    const updateDashboard = (content: string): void => {
      try {
        session.dashboard.content.write(truncateForGlass(content, 120));
      } catch (err) {
        logger.debug({ err, sessionId, dashboardContent: content }, 'Dashboard update failed');
      }
    };

    const interruptActiveAudio = (): void => {
      session.audio.stopAudio();
    };

    /**
     * Drive the privacy LED while the mic is capturing, so bystanders can see
     * the glasses are listening. Additive and best-effort: devices without a
     * light (`hasLight === false`) simply skip it, and an LED failure must
     * never take down the voice loop.
     */
    const setPrivacyIndicator = async (lit: boolean): Promise<void> => {
      if (!session.capabilities?.hasLight) return;
      try {
        if (lit) {
          await session.led.solid(PRIVACY_LED_COLOR, PRIVACY_LED_MAX_MS);
        } else {
          await session.led.turnOff();
        }
      } catch (err) {
        logger.debug({ err: (err as Error).message, sessionId, lit }, 'Privacy LED unavailable');
      }
    };

    /**
     * The indicator tracks the **microphone**, not the request in flight.
     *
     * These are not the same clock: VadBuffer force-flushes at `maxDurationMs`
     * (10s) and deliberately keeps capturing, so a long utterance emits while
     * the mic is still open. Letting the processing pipeline switch the light
     * off at that point made it lie about recording — the whole point of the
     * light is that a bystander can trust it.
     *
     * `led.solid()` only holds for a fixed duration, so a capture that outlives
     * `PRIVACY_LED_MAX_MS` needs re-arming; the interval does that while, and
     * only while, VAD says the mic is open.
     */
    const startPrivacyIndicator = (): void => {
      capturing = true;
      void setPrivacyIndicator(true);
      if (ledRefresh) return;
      ledRefresh = setInterval(() => {
        if (capturing) void setPrivacyIndicator(true);
        else clearPrivacyRefresh();
      }, PRIVACY_LED_REFRESH_MS);
      // Never let the indicator's heartbeat hold the process open.
      ledRefresh.unref?.();
    };

    const stopPrivacyIndicator = (): void => {
      capturing = false;
      clearPrivacyRefresh();
      void setPrivacyIndicator(false);
    };

    /** Speak a reply, honouring the wearer's `speak_answers` and voice choice. */
    const speakReply = async (text: string): Promise<void> => {
      if (!speakAnswersAllowed(session)) return; // the display still shows it
      await session.audio.speak(text, speakOptions(session));
    };

    const renderLayout = (): void => {
      if (!hasDisplay(session.capabilities)) return;

      const layout = selectBridgeLayout(lastTranscript, lastAssistantResponse, statusText);
      switch (layout.type) {
        case 'double':
          session.layouts.showDoubleTextWall(layout.topText, layout.bottomText);
          break;
        case 'reference':
          session.layouts.showReferenceCard(layout.title, layout.text);
          break;
        case 'text':
          session.layouts.showTextWall(layout.text);
          break;
        case 'dashboard':
          session.layouts.showDashboardCard(layout.leftText, layout.rightText);
          break;
      }
    };

    const refreshUi = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastTranscriptionUiUpdateAt < TRANSCRIPTION_UI_DEBOUNCE_MS) {
        return;
      }
      lastTranscriptionUiUpdateAt = now;
      renderLayout();
      updateDashboard(statusText);
    };

    const updateCapabilitiesState = (capabilities: Capabilities | null): void => {
      session.capabilities = capabilities;
      logger.info({ sessionId, userId, capabilities }, 'Mentra capabilities updated');

      if (capabilities && !capabilities.hasMicrophone) {
        statusText = 'Microphone unavailable';
        lastTranscript = '';
        lastAssistantResponse = '';
      } else if (statusText === 'Microphone unavailable') {
        statusText = 'Listening...';
      }

      refreshUi(true);
    };

    updateCapabilitiesState(session.capabilities);
    session.events.onCapabilitiesUpdate(({ capabilities }) => {
      updateCapabilitiesState(capabilities);
    });

    // When VAD produces an utterance, run the full voice pipeline
    vadBuffer.on('utterance', async (segment: UtteranceSegment) => {
      if (!hasMicrophone(session.capabilities)) {
        logger.warn({ sessionId }, 'Skipping utterance because microphone capability is unavailable');
        return;
      }

      logger.info({ durationMs: segment.durationMs }, 'Processing utterance');

      try {
        interruptActiveAudio();
        statusText = 'Transcribing...';
        lastAssistantResponse = '';
        refreshUi(true);

        // Step 1: STT, in the language the wearer said they speak
        const transcript = await transcribeAudio(segment.wavBuffer, {
          language: transcribeLanguage(session),
        });
        logger.info({ transcript }, 'Transcribed utterance');

        if (!transcript.trim()) {
          logger.debug('Empty transcript, skipping');
          statusText = 'Listening...';
          refreshUi(true);
          return;
        }

        lastTranscript = transcript;
        statusText = 'Thinking...';
        refreshUi(true);

        // Step 2: the Companion brain. `answer()` recalls and persists
        // unconditionally, so the wearer's opt-in decides whether we call it at
        // all — the manifest promises memory is off until they say otherwise,
        // and that promise is kept here or nowhere.
        const useMemory = memoryAllowed(session);
        const result = useMemory
          ? await answer({ sessionId, userId, text: transcript })
          : await plainAnswer({ sessionId, userId, text: transcript });
        const responseText = result.answer;
        logger.info(
          {
            memoryEnabled: useMemory,
            remembered: result.remembered,
            usedRecallCount: result.usedRecallCount,
            usedContext: result.usedContext,
          },
          'Companion answer'
        );

        lastAssistantResponse = responseText;
        statusText = 'Speaking...';
        refreshUi(true);

        // Step 3: TTS — use Mentra native speak for low latency
        await speakReply(responseText);
        statusText = 'Listening...';
        refreshUi(true);

      } catch (err) {
        logger.error({ err }, 'Voice pipeline error');
        statusText = 'Voice pipeline error';
        lastAssistantResponse = 'Sorry, I encountered an error. Please try again.';
        refreshUi(true);
        try {
          await speakReply('Sorry, I encountered an error. Please try again.');
        } catch (ttsErr) {
          logger.error({ ttsErr }, 'TTS error recovery failed');
        }
      }
      // Deliberately no LED change here: this handler runs *while the mic may
      // still be open* (VadBuffer force-flushes long utterances mid-capture).
      // Only VAD may move the indicator — see startPrivacyIndicator.
    });

    // Subscribe to VAD events
    session.events.onVoiceActivity((vad) => {
      if (!hasMicrophone(session.capabilities)) return;
      const isSpeaking = vad.status === true || vad.status === 'true';
      // VAD is the only signal that reflects the actual mic state, so it is the
      // only thing allowed to drive the privacy light.
      if (isSpeaking) startPrivacyIndicator();
      else stopPrivacyIndicator();
      vadBuffer.onVad(isSpeaking);
    });

    // Subscribe to audio chunks
    session.events.onAudioChunk((chunk) => {
      if (!hasMicrophone(session.capabilities)) return;
      if (chunk.arrayBuffer) {
        const buffer = Buffer.from(chunk.arrayBuffer);
        vadBuffer.addChunk(buffer, chunk.sampleRate ? Number(chunk.sampleRate) : undefined);
      }
    });

    // Subscribe to MentraOS transcription as fallback / fast-path for low-latency UI updates
    session.events.onTranscription((data) => {
      if (!hasMicrophone(session.capabilities) || !data.text?.trim()) return;

      lastTranscript = data.text;
      if (data.isFinal) {
        statusText = 'Thinking...';
        refreshUi(true);
      } else {
        statusText = 'Listening...';
        refreshUi();
      }

      if (data.isFinal) {
        logger.debug({ text: data.text }, 'MentraOS transcription (fast-path)');
      }
    });

    // The calendar arrives as a push stream (there is no query API), so cache
    // what MentraOS sends to back the `whats_on_my_calendar` tool. Requires the
    // CALENDAR permission; without it this handler simply never fires.
    session.events.onCalendarEvent((event) => {
      try {
        recordCalendarEvent(sessionId, {
          eventId: event.eventId,
          title: event.title,
          dtStart: event.dtStart,
          dtEnd: event.dtEnd,
          timezone: event.timezone,
        });
      } catch (err) {
        logger.debug({ err: (err as Error).message, sessionId }, 'Calendar event ignored');
      }
    });

    session.events.onButtonPress((press) => {
      interruptActiveAudio();
      statusText = 'Listening...';
      refreshUi(true);
      logger.debug({ press }, 'Button press');
    });

    // Cleanup on disconnect
    // A disconnect may be transient — the SDK auto-reconnects this same session.
    // So park the UI and stop capturing, but keep the VAD buffer and the rolling
    // history intact; destroying them here would leave a reconnected wearer with
    // a mic that never hears anything. Real teardown happens in onStop.
    session.events.on('disconnected', () => {
      logger.info({ sessionId }, 'Session disconnected (may reconnect), pausing capture');
      statusText = 'Disconnected';
      if (hasDisplay(session.capabilities)) {
        session.layouts.clearView();
      }
      interruptActiveAudio();
      stopPrivacyIndicator();
    });
  }

  /**
   * Voice tools invoked through MentraOS Cloud. The returned string is spoken
   * to the wearer, so failures must still resolve to a sentence.
   *
   * A ToolCall carries no sessionId, so we borrow the live session's id to keep
   * the tool coherent with the wearer's ongoing conversation, and fall back to
   * userId otherwise. `getSessionId()` returns the literal 'unknown-session-id'
   * when the session isn't connected — keying memory on that would merge every
   * disconnected wearer into one bucket, so it is treated as absent.
   */
  protected async onToolCall(toolCall: ToolCall): Promise<string | undefined> {
    const activeSessionId = toolCall.activeSession?.getSessionId();
    const sessionId =
      activeSessionId && activeSessionId !== UNKNOWN_SESSION_ID ? activeSessionId : toolCall.userId;

    // The tool path reaches the same memory as the voice loop, so the wearer's
    // opt-in has to gate it here too — otherwise "Remember our conversations"
    // would be off while a voice tool quietly wrote to the appliance anyway.
    // `take_photo` gates itself inside capturePhotoToMemory.
    if (
      (toolCall.toolId === ToolId.RememberThis || toolCall.toolId === ToolId.SearchMemory) &&
      !memoryAllowed(toolCall.activeSession)
    ) {
      logger.info({ toolId: toolCall.toolId, sessionId }, 'Tool call refused: memory is off for this wearer');
      return toolCall.toolId === ToolId.RememberThis ? MEMORY_OFF_WRITE_REPLY : MEMORY_OFF_SEARCH_REPLY;
    }

    try {
      const result = await handleToolCall(toolCall, sessionId);

      // `take_photo` needs the live session's camera, which only the bridge has.
      if (isTakePhotoSentinel(result)) {
        const session = toolCall.activeSession;
        if (!session) return "I can't take a photo unless your glasses are connected.";
        return capturePhotoToMemory(session, sessionId, takePhotoNote(result));
      }

      return result;
    } catch (err) {
      logger.error({ err: (err as Error).message, toolId: toolCall.toolId }, 'Tool call failed');
      return 'Sorry, something went wrong handling that.';
    }
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    logger.info({ sessionId, userId, reason }, 'Session stopped');
    // The session is really over now (not a reconnectable blip): release the VAD
    // buffer and drop short-term state so the next wearer starts clean.
    const teardown = this.teardowns.get(sessionId);
    this.teardowns.delete(sessionId);
    try {
      if (teardown) teardown();
      else {
        sessionHistory.clearSession(sessionId);
        clearCalendarEvents(sessionId);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, sessionId }, 'Session teardown failed');
    }
  }
}
