import express from 'express';
import request from 'supertest';

// Mock provider module
jest.mock('../../providers', () => ({
  resolveProvider: jest.fn(() => ({
    name: 'ollama',
    listModels: jest.fn().mockResolvedValue([
      { id: 'llama3.2', created: 1700000000, owned_by: 'ollama' },
      { id: 'mistral', created: 1700000000, owned_by: 'ollama' },
    ]),
  })),
}));

jest.mock('../../config', () => ({
  config: {
    providers: { default: 'ollama' },
    facade: { apiKey: '' },
    rateLimit: { rpm: 60, tpm: 100000 },
  },
}));

// Mock redis to prevent connection attempts
jest.mock('../../store/redis', () => ({
  incrRateLimit: jest.fn().mockResolvedValue(1),
}));

import { modelsRouter } from '../../facade/models';
import { requireApiKey } from '../../middleware/auth';
import { rateLimitMiddleware } from '../../middleware/rate-limit';

const app = express();
app.use(express.json());
app.use(requireApiKey);
app.use(rateLimitMiddleware);
app.use('/v1/models', modelsRouter);

describe('GET /v1/models', () => {
  it('should return a list of models', async () => {
    const res = await request(app)
      .get('/v1/models')
      .set('Authorization', 'Bearer test-key');

    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('should include model id and object fields', async () => {
    const res = await request(app)
      .get('/v1/models')
      .set('Authorization', 'Bearer test-key');

    expect(res.status).toBe(200);
    const model = res.body.data[0];
    expect(model).toHaveProperty('id');
    expect(model).toHaveProperty('object', 'model');
    expect(model).toHaveProperty('created');
    expect(model).toHaveProperty('owned_by');
  });

  it('should return 401 without auth header', async () => {
    const res = await request(app).get('/v1/models');
    expect(res.status).toBe(401);
  });
});
