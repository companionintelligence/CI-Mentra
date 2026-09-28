import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { resolveProvider } from '../providers/index.ts';
import { type TranscriptionRequest } from '../providers/types.ts';
import { type CanonicalTurn } from '../canonical/types.ts';
import pino from 'pino';

const logger = pino({ name: 'facade-transcriptions' });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/flac', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
      'audio/webm', 'audio/x-m4a', 'video/mp4', 'application/octet-stream'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}`));
    }
  },
});

export const audioTranscriptionsRouter: Router = Router();

audioTranscriptionsRouter.post('/', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({
      error: {
        message: 'Missing required file field',
        type: 'invalid_request_error',
        code: 'missing_required_field',
      },
    });
    return;
  }

  const model = (req.body as Record<string, string>).model || 'whisper-1';
  const language = (req.body as Record<string, string>).language;
  const prompt = (req.body as Record<string, string>).prompt;
  const responseFormat = (req.body as Record<string, string>).response_format || 'json';
  const temperature = parseFloat((req.body as Record<string, string>).temperature || '0');

  logger.info({ model, filename: req.file.originalname, size: req.file.size }, 'transcription request');

  const transcriptionReq: TranscriptionRequest = {
    file: req.file.buffer,
    filename: req.file.originalname,
    model,
    language,
    prompt,
    response_format: responseFormat,
    temperature,
  };

  // Try each provider that supports transcription
  const providerConfigs: Array<{ model: string; name: string }> = [
    { model: 'gpt-4', name: 'openai' },
    { model: 'vllm:whisper', name: 'vllm' },
  ];
  let lastError: Error | null = null;

  for (const providerConfig of providerConfigs) {
    const dummyTurn: CanonicalTurn = {
      model: providerConfig.model,
      input_messages: [],
      id: '',
      tenant_id: '',
      user_id: '',
      generation_params: {},
      streaming_mode: 'none',
      output_mode: 'text',
    };
    const provider = resolveProvider(dummyTurn);

    if (!provider.transcribe) continue;

    try {
      const result = await provider.transcribe(transcriptionReq);

      if (responseFormat === 'text') {
        res.type('text/plain').send(result.text);
      } else if (responseFormat === 'verbose_json') {
        res.json({
          task: 'transcribe',
          language: result.language || language || 'en',
          duration: result.duration || 0,
          text: result.text,
          segments: result.segments || [],
        });
      } else {
        res.json({ text: result.text });
      }
      return;
    } catch (err) {
      logger.warn({ err, provider: providerConfig.name }, 'Transcription provider failed');
      lastError = err as Error;
    }
  }

  logger.error({ lastError }, 'All transcription providers failed');
  res.status(502).json({
    error: { message: 'All transcription providers failed', type: 'api_error' },
  });
});
