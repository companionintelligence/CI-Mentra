import { Router } from 'express';
import { resolveProvider } from '../providers';
import { config } from '../config';
import { CanonicalTurn } from '../canonical/types';
import pino from 'pino';

const logger = pino({ name: 'facade-models' });

export const modelsRouter = Router();

modelsRouter.get('/', async (_req, res) => {
  try {
    const dummyTurn: CanonicalTurn = {
      model: config.providers.default,
      input_messages: [],
      id: '',
      tenant_id: '',
      user_id: '',
      generation_params: {},
      streaming_mode: 'none',
      output_mode: 'text',
    };

    const defaultProvider = resolveProvider(dummyTurn);
    const models = await defaultProvider.listModels();

    // Always include default TTS and Whisper models
    const allModels = [
      ...models,
      { id: 'tts:default', created: 0, owned_by: 'mentra' },
      { id: 'whisper-1', created: 0, owned_by: 'mentra' },
    ];

    res.json({
      object: 'list',
      data: allModels.map(m => ({
        id: m.id,
        object: 'model',
        created: m.created,
        owned_by: m.owned_by,
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list models');
    res.status(500).json({
      error: { message: 'Failed to list models', type: 'api_error' },
    });
  }
});
