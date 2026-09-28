import express from 'express';
import request from 'supertest';

jest.mock('../../providers', () => ({
  resolveProvider: jest.fn(() => ({
    name: 'ollama',
    chatCompletion: jest.fn().mockResolvedValue({
      id: 'chatcmpl-test',
      model: 'llama3.2',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello from responses.' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    }),
    chatCompletionStream: jest.fn().mockImplementation(async (_turn: unknown, res: { write: (s: string) => void }) => {
      const chunk = {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
    }),
  })),
}));

jest.mock('../../config', () => ({
  config: {
    providers: { default: 'ollama' },
    facade: { apiKey: '' },
    rateLimit: { rpm: 60, tpm: 100000 },
  },
}));

jest.mock('../../store/redis', () => ({
  incrRateLimit: jest.fn().mockResolvedValue(1),
}));

jest.mock('../../store/postgres', () => ({
  getOrCreateConversation: jest.fn(),
  getConversationMessages: jest.fn().mockResolvedValue([]),
  appendMessage: jest.fn().mockResolvedValue(undefined),
}));

import { responsesRouter } from '../../facade/responses.ts';
import { requireApiKey } from '../../middleware/auth.ts';
import { rateLimitMiddleware } from '../../middleware/rate-limit.ts';

const app = express();
app.use(express.json());
app.use(requireApiKey);
app.use(rateLimitMiddleware);
app.use('/v1/responses', responsesRouter);

describe('POST /v1/responses', () => {
  it('emits semantic response stream events and terminates with [DONE]', async () => {
    const res = await request(app)
      .post('/v1/responses')
      .set('Authorization', 'Bearer test-key')
      .send({
        model: 'llama3.2',
        input: 'Hello',
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"type":"response.created"');
    expect(res.text).toContain('"type":"response.output_item.added"');
    expect(res.text).toContain('"type":"response.content_part.added"');
    expect(res.text).toContain('"type":"response.output_text.delta"');
    expect(res.text).toContain('"type":"response.content_part.done"');
    expect(res.text).toContain('"type":"response.output_item.done"');
    expect(res.text).toContain('"type":"response.completed"');
    expect(res.text).toContain('data: [DONE]');
  });
});
