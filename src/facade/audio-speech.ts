import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config';
import { resolveProvider } from '../providers';
import { CanonicalTurn } from '../canonical/types';
import pino from 'pino';

const logger = pino({ name: 'facade-speech' });

export const audioSpeechRouter = Router();

interface SpeechRequest {
  model: string;
  input: string;
  voice?: string;
  response_format?: string;
  speed?: number;
}

const FORMAT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

audioSpeechRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as SpeechRequest;

  if (!body.model || !body.input) {
    res.status(400).json({
      error: {
        message: 'Missing required fields: model, input',
        type: 'invalid_request_error',
        code: 'missing_required_field',
      },
    });
    return;
  }

  const voice = body.voice || 'alloy';
  const responseFormat = body.response_format || 'mp3';
  const speed = body.speed || 1.0;
  const mimeType = FORMAT_TO_MIME[responseFormat] || 'audio/mpeg';

  logger.info({ model: body.model, voice, format: responseFormat, inputLength: body.input.length }, 'speech request');

  // Try ElevenLabs if configured
  if (config.audio.ttsProvider === 'elevenlabs' && config.audio.elevenlabsApiKey) {
    try {
      const voiceId = voice === 'alloy' ? config.audio.elevenlabsDefaultVoiceId : voice;
      const resp = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: body.input,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        },
        {
          headers: {
            'xi-api-key': config.audio.elevenlabsApiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          responseType: 'arraybuffer',
          timeout: 30000,
        }
      );
      const audioBuffer = Buffer.from(resp.data as ArrayBuffer);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.send(audioBuffer);
      return;
    } catch (err) {
      logger.warn({ err }, 'ElevenLabs TTS failed, falling back');
    }
  }

  // Try OpenAI TTS
  const dummyTurn: CanonicalTurn = {
    model: 'gpt-4',
    input_messages: [],
    id: '',
    tenant_id: '',
    user_id: '',
    generation_params: {},
    streaming_mode: 'none',
    output_mode: 'text',
  };
  const provider = resolveProvider(dummyTurn);

  if (provider.speech) {
    try {
      const audioBuffer = await provider.speech({
        model: body.model,
        input: body.input,
        voice,
        response_format: responseFormat,
        speed,
      });
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', audioBuffer.length);
      res.send(audioBuffer);
      return;
    } catch (err) {
      logger.warn({ err }, 'OpenAI TTS failed');
    }
  }

  res.status(503).json({
    error: { message: 'No TTS provider available', type: 'api_error' },
  });
});
