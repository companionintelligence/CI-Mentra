import { Router, Request, Response } from 'express';
import { normalizeResponsesRequestToCanonical, ResponsesRequest } from '../canonical/normalizer';
import { resolveProvider } from '../providers';
import { AuthenticatedRequest } from '../middleware/auth';
import { getOrCreateConversation, getConversationMessages, appendMessage } from '../store/postgres';
import { CanonicalTurn, CanonicalMessage } from '../canonical/types';
import { Provider } from '../providers/types';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

const logger = pino({ name: 'facade-responses' });

export const responsesRouter = Router();

responsesRouter.post('/', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const body = req.body as ResponsesRequest;

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

  const turn = normalizeResponsesRequestToCanonical(
    body,
    authReq.tenantId || 'default',
    authReq.userId || 'default'
  );

  const provider = resolveProvider(turn);
  logger.info({ model: turn.model, provider: provider.name, stream: body.stream }, 'responses request');

  // For non-stateful providers, reconstruct conversation from store
  if ((provider.name === 'ollama' || provider.name === 'vllm') && turn.previous_response_id) {
    try {
      const conversation = await getOrCreateConversation(
        turn.tenant_id,
        turn.user_id,
        turn.previous_response_id
      );
      const storedMessages = await getConversationMessages(conversation.id);
      const historicalMessages: CanonicalMessage[] = storedMessages.map(m => ({
        role: m.role as CanonicalMessage['role'],
        content: m.content_json as string,
      }));

      // Prepend historical messages before current turn
      turn.input_messages = [...historicalMessages, ...turn.input_messages];
      turn.conversation_id = conversation.id;
    } catch (err) {
      logger.warn({ err }, 'Failed to load conversation history, proceeding without it');
    }
  }

  const responseId = `resp_${uuidv4().replace(/-/g, '').substring(0, 24)}`;

  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({
      type: 'response.created',
      response: { id: responseId, status: 'in_progress', model: turn.model },
    })}\n\n`);

    try {
      let fullContent = '';

      await streamResponsesEvents(turn, provider, res, responseId, (content) => {
        fullContent += content;
      });

      res.write(`data: ${JSON.stringify({
        type: 'response.completed',
        response: { id: responseId, status: 'completed', model: turn.model },
      })}\n\n`);

      if (turn.conversation_id) {
        await appendMessage(turn.conversation_id, 'assistant', fullContent, provider.name);
      }
    } catch (err) {
      logger.error({ err }, 'Responses streaming failed');
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: { message: 'Upstream provider error', type: 'api_error' },
      })}\n\n`);
    } finally {
      res.end();
    }
    return;
  }

  // Non-streaming
  try {
    const result = await provider.chatCompletion(turn);
    const content = result.choices[0]?.message?.content || '';

    if (turn.conversation_id) {
      await appendMessage(turn.conversation_id, 'assistant', content, provider.name, result.usage);
    }

    res.json({
      id: responseId,
      object: 'response',
      model: turn.model,
      status: 'completed',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: content }],
      }],
      usage: result.usage,
    });
  } catch (err) {
    logger.error({ err }, 'Responses completion failed');
    res.status(502).json({
      error: { message: 'Upstream provider error', type: 'api_error' },
    });
  }
});

async function streamResponsesEvents(
  turn: CanonicalTurn,
  provider: Provider,
  res: Response,
  responseId: string,
  onContent: (chunk: string) => void
): Promise<void> {
  let buffer = '';

  const fakeRes = {
    write: (data: Buffer | string) => {
      const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      buffer += str;

      // Parse SSE lines and convert to Responses events
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice('data: '.length).trim();
        if (payload === '[DONE]') continue;

        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            onContent(delta);
            res.write(`data: ${JSON.stringify({
              type: 'response.output_text.delta',
              delta,
              response_id: responseId,
            })}\n\n`);
          }
        } catch {
          // ignore parse errors on malformed SSE chunks
        }
      }
      return true;
    },
    end: () => { /* no-op for fake response */ },
  } as unknown as Response;

  await provider.chatCompletionStream(turn, fakeRes);
}
