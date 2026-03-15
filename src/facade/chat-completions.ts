import { Router, Request, Response } from 'express';
import { normalizeChatCompletionToCanonical, ChatCompletionRequest } from '../canonical/normalizer';
import { resolveProvider } from '../providers';
import { AuthenticatedRequest } from '../middleware/auth';
import pino from 'pino';

const logger = pino({ name: 'facade-chat' });

export const chatCompletionsRouter = Router();

chatCompletionsRouter.post('/', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const body = req.body as ChatCompletionRequest;

  if (!body.model || !body.messages) {
    res.status(400).json({
      error: {
        message: 'Missing required fields: model, messages',
        type: 'invalid_request_error',
        code: 'missing_required_field',
      },
    });
    return;
  }

  const turn = normalizeChatCompletionToCanonical(
    body,
    authReq.tenantId || 'default',
    authReq.userId || 'default'
  );

  const provider = resolveProvider(turn);
  logger.info({ model: turn.model, provider: provider.name, stream: body.stream }, 'chat completion request');

  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      await provider.chatCompletionStream(turn, res);
    } catch (err) {
      logger.error({ err }, 'Streaming chat completion failed');
      const errorData = JSON.stringify({
        error: { message: 'Upstream provider error', type: 'api_error' },
      });
      res.write(`data: ${errorData}\n\n`);
    } finally {
      res.end();
    }
    return;
  }

  try {
    const result = await provider.chatCompletion(turn);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Chat completion failed');
    res.status(502).json({
      error: { message: 'Upstream provider error', type: 'api_error' },
    });
  }
});
