import express from 'express';
import request from 'supertest';

jest.mock('../../providers', () => ({
  resolveProvider: jest.fn(() => ({
    name: 'ollama',
    chatCompletion: jest.fn().mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'llama3.2',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello! How can I help you?' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    }),
    chatCompletionStream: jest.fn().mockImplementation(async (_turn: unknown, res: { write: (s: string) => void }) => {
      const chunk = { id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] };
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

import { chatCompletionsRouter } from '../../facade/chat-completions.ts';
import { requireApiKey } from '../../middleware/auth.ts';
import { rateLimitMiddleware } from '../../middleware/rate-limit.ts';

const app = express();
app.use(express.json());
app.use(requireApiKey);
app.use(rateLimitMiddleware);
app.use('/v1/chat/completions', chatCompletionsRouter);

describe('POST /v1/chat/completions', () => {
  it('should return a chat completion response', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test-key')
      .send({
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'Hello' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.choices).toBeDefined();
    expect(res.body.choices[0].message.content).toBe('Hello! How can I help you?');
  });

  it('should return 400 for missing required fields', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test-key')
      .send({ model: 'llama3.2' }); // missing messages

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should stream chat completion when stream=true', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', 'Bearer test-key')
      .send({
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({ model: 'llama3.2', messages: [] });

    expect(res.status).toBe(401);
  });
});
