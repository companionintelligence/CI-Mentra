import { AppServer, AppSession } from '@mentra/sdk';
import { config } from '../config';
import { VadBuffer, UtteranceSegment } from '../voice/vad-buffer';
import { transcribeAudio } from '../voice/stt';
import { resolveProvider } from '../providers';
import { normalizeChatCompletionToCanonical } from '../canonical/normalizer';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

const logger = pino({ name: 'mentra-bridge' });

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

    await session.layouts.showTextWall('Mentra Bridge connected. Listening...');

    const conversationId = uuidv4();

    const vadBuffer = new VadBuffer({
      maxDurationMs: 10000,
      sampleRate: 16000,
    });

    // When VAD produces an utterance, run the full voice pipeline
    vadBuffer.on('utterance', async (segment: UtteranceSegment) => {
      logger.info({ durationMs: segment.durationMs }, 'Processing utterance');

      try {
        // Step 1: STT
        const transcript = await transcribeAudio(segment.wavBuffer);
        logger.info({ transcript }, 'Transcribed utterance');

        if (!transcript.trim()) {
          logger.debug('Empty transcript, skipping');
          return;
        }

        await session.layouts.showTextWall(`You: ${transcript}`);

        // Step 2: LLM
        const turn = normalizeChatCompletionToCanonical(
          {
            model: 'llama3.2',
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

        await session.layouts.showTextWall(`Assistant: ${responseText}`);

        // Step 3: TTS — use Mentra native speak for low latency
        await session.audio.speak(responseText);

      } catch (err) {
        logger.error({ err }, 'Voice pipeline error');
        try {
          await session.audio.speak('Sorry, I encountered an error. Please try again.');
        } catch (ttsErr) {
          logger.error({ ttsErr }, 'TTS error recovery failed');
        }
      }
    });

    // Subscribe to VAD events
    session.events.onVoiceActivity((vad) => {
      const isSpeaking = vad.status === true || vad.status === 'true';
      vadBuffer.onVad(isSpeaking);
    });

    // Subscribe to audio chunks
    session.events.onAudioChunk((chunk) => {
      if (chunk.arrayBuffer) {
        const buffer = Buffer.from(chunk.arrayBuffer);
        vadBuffer.addChunk(buffer, chunk.sampleRate ? Number(chunk.sampleRate) : undefined);
      }
    });

    // Subscribe to MentraOS transcription as fallback / fast-path
    session.events.onTranscription((data) => {
      if (data.isFinal) {
        logger.debug({ text: data.text }, 'MentraOS transcription (fast-path)');
      }
    });

    session.events.onButtonPress((press) => {
      logger.debug({ press }, 'Button press');
    });

    // Cleanup on disconnect
    session.events.on('disconnected', () => {
      logger.info({ sessionId }, 'Session disconnected, cleaning up');
      vadBuffer.destroy();
    });
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    logger.info({ sessionId, userId, reason }, 'Session stopped');
  }
}
