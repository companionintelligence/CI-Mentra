import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config';
import { resolveProvider } from '../providers';
import { TranscriptionRequest } from '../providers/types';
import { CanonicalTurn } from '../canonical/types';
import pino from 'pino';

const logger = pino({ name: 'stt' });

export interface SttOptions {
  model?: string;
  language?: string;
  provider?: 'openai' | 'vllm' | 'facade';
}

function makeDummyTurn(model: string): CanonicalTurn {
  return {
    id: '',
    tenant_id: '',
    user_id: '',
    model,
    input_messages: [],
    generation_params: {},
    streaming_mode: 'none',
    output_mode: 'text',
  };
}

/**
 * Transcribes a WAV audio buffer using the configured STT provider.
 *
 * @param wavBuffer - WAV-encoded audio data
 * @param options - Optional STT configuration
 * @returns Transcribed text
 */
export async function transcribeAudio(wavBuffer: Buffer, options: SttOptions = {}): Promise<string> {
  const model = options.model || 'whisper-1';
  const language = options.language;

  const req: TranscriptionRequest = {
    file: wavBuffer,
    filename: 'audio.wav',
    model,
    language,
    response_format: 'json',
  };

  // Try to use the configured provider's transcribe method
  try {
    const providerModel = options.provider === 'openai' ? 'gpt-4' :
      options.provider === 'vllm' ? 'vllm:whisper' : model;

    const provider = resolveProvider(makeDummyTurn(providerModel));

    if (provider.transcribe) {
      const result = await provider.transcribe(req);
      return result.text;
    }
  } catch (err) {
    logger.error({ err }, 'Primary STT provider failed');
  }

  // Fallback: post directly to facade transcription endpoint
  try {
    const form = new FormData();
    form.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
    form.append('model', model);
    if (language) form.append('language', language);

    const resp = await axios.post(`${config.audio.baseUrl}/v1/audio/transcriptions`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${config.facade.apiKey}`,
      },
      timeout: 30000,
    });
    return (resp.data as { text: string }).text;
  } catch (err) {
    logger.error({ err }, 'Fallback STT also failed');
    throw err;
  }
}
