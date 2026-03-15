import { Router } from 'express';
import { modelsRouter } from './models';
import { chatCompletionsRouter } from './chat-completions';
import { responsesRouter } from './responses';
import { audioTranscriptionsRouter } from './audio-transcriptions';
import { audioSpeechRouter } from './audio-speech';
import { requireApiKey } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rate-limit';

export const facadeRouter = Router();

// Apply auth and rate limiting to all facade routes
facadeRouter.use(requireApiKey);
facadeRouter.use(rateLimitMiddleware);

facadeRouter.use('/models', modelsRouter);
facadeRouter.use('/chat/completions', chatCompletionsRouter);
facadeRouter.use('/responses', responsesRouter);
facadeRouter.use('/audio/transcriptions', audioTranscriptionsRouter);
facadeRouter.use('/audio/speech', audioSpeechRouter);
