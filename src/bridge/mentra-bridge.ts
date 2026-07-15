import { AppServer, AppSession } from '@mentra/sdk';
import type { Capabilities } from '@mentra/sdk';
import { config } from '../config';
import { VadBuffer, UtteranceSegment } from '../voice/vad-buffer';
import { transcribeAudio } from '../voice/stt';
import { resolveProvider } from '../providers';
import { normalizeChatCompletionToCanonical } from '../canonical/normalizer';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

const logger = pino({ name: 'mentra-bridge' });
const GLASS_TEXT_LIMIT = 280;
const TRANSCRIPTION_UI_DEBOUNCE_MS = 250;

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
 * MentraBridge is the MentraOS AppServer that:
 * 1. Receives session webhooks from MentraOS Cloud
 * 2. Subscribes to audio (VAD + AudioChunk) or transcription events
 * 3. Routes voice input through the STT → LLM → TTS pipeline
 * 4. Plays the response back on the glasses
 */
export class MentraBridge extends AppServer {
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

    const conversationId = uuidv4();
    let lastTranscript = '';
    let lastAssistantResponse = '';
    let statusText = 'Listening...';
    let lastTranscriptionUiUpdateAt = 0;

    const vadBuffer = new VadBuffer({
      maxDurationMs: 10000,
      sampleRate: 16000,
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

        // Step 1: STT
        const transcript = await transcribeAudio(segment.wavBuffer);
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

        // Step 2: LLM — model comes from the standardized inference config.
        // When the default provider is the Hub hermes/openclaw backend, prefer
        // its model; otherwise use the (Hub) Ollama default.
        const defaultModel =
          config.providers.default === 'hermes' && config.providers.hermes.defaultModel
            ? config.providers.hermes.defaultModel
            : config.providers.ollama.defaultModel;
        const turn = normalizeChatCompletionToCanonical(
          {
            model: defaultModel,
            messages: [
              { role: 'system', content: 'You are a helpful voice assistant for Mentra smart glasses. Keep responses concise (1-3 sentences).' },
              { role: 'user', content: transcript },
            ],
            stream: false,
          },
          'mentra-bridge',
          userId
        );
        turn.conversation_id = conversationId;

        const provider = resolveProvider(turn);
        const result = await provider.chatCompletion(turn);
        const responseText = result.choices[0]?.message?.content || '';
        logger.info({ responseText }, 'LLM response');

        lastAssistantResponse = responseText;
        statusText = 'Speaking...';
        refreshUi(true);

        // Step 3: TTS — use Mentra native speak for low latency
        await session.audio.speak(responseText);
        statusText = 'Listening...';
        refreshUi(true);

      } catch (err) {
        logger.error({ err }, 'Voice pipeline error');
        statusText = 'Voice pipeline error';
        lastAssistantResponse = 'Sorry, I encountered an error. Please try again.';
        refreshUi(true);
        try {
          await session.audio.speak('Sorry, I encountered an error. Please try again.');
        } catch (ttsErr) {
          logger.error({ ttsErr }, 'TTS error recovery failed');
        }
      }
    });

    // Subscribe to VAD events
    session.events.onVoiceActivity((vad) => {
      if (!hasMicrophone(session.capabilities)) return;
      const isSpeaking = vad.status === true || vad.status === 'true';
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

    session.events.onButtonPress((press) => {
      interruptActiveAudio();
      statusText = 'Listening...';
      refreshUi(true);
      logger.debug({ press }, 'Button press');
    });

    // Cleanup on disconnect
    session.events.on('disconnected', () => {
      logger.info({ sessionId }, 'Session disconnected, cleaning up');
      statusText = 'Disconnected';
      if (hasDisplay(session.capabilities)) {
        session.layouts.clearView();
      }
      interruptActiveAudio();
      vadBuffer.destroy();
    });
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    logger.info({ sessionId, userId, reason }, 'Session stopped');
  }
}
