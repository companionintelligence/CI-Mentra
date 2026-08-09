import { Router } from 'express';
import { modelsRouter } from './models.ts';
import { chatCompletionsRouter } from './chat-completions.ts';
import { responsesRouter } from './responses.ts';
import { audioTranscriptionsRouter } from './audio-transcriptions.ts';
import { audioSpeechRouter } from './audio-speech.ts';
import { requireAuth } from '../middleware/auth.ts';
import { rateLimitMiddleware } from '../middleware/rate-limit.ts';

export const facadeRouter = Router();

// Apply auth (CI-Portal OIDC or static facade key) and rate limiting to all facade routes
facadeRouter.use(requireAuth);
facadeRouter.use(rateLimitMiddleware);

facadeRouter.use('/models', modelsRouter);
facadeRouter.use('/chat/completions', chatCompletionsRouter);
facadeRouter.use('/responses', responsesRouter);
facadeRouter.use('/audio/transcriptions', audioTranscriptionsRouter);
facadeRouter.use('/audio/speech', audioSpeechRouter);
