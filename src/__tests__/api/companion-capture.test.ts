import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mutable so each test can change the owner list or the memory switch.
const mockConfig = {
  providers: { default: 'ollama' },
  facade: { apiKey: '' },
  auth: {
    oidc: { enabled: false },
    owners: ['owner@example.com'] as string[],
    portal: {
      enabled: true,
      issuer: 'https://hub.example.test',
      jwksUri: 'https://hub.example.test/api/auth/jwks',
      audience: ['ci-mentra'],
    },
  },
  dev: { allowAnonymous: false },
  agent: { maxHistoryTurns: 8, persona: '' },
  memory: { platform: 'mentra' },
  companion: { photoDir: '' },
};
jest.mock('../../config', () => ({ config: mockConfig }));

jest.mock('pino', () => {
  const factory = () => ({
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
  });
  return { __esModule: true, default: factory, pino: factory };
});

// The Portal verifier is replaced: these tests cover what the appliance does with a
// verified identity (owner check, routing, storage), not JWKS fetching.
jest.mock('../../auth/portal-token', () => ({ verifyPortalToken: jest.fn() }));

jest.mock('../../agent/answer-service', () => ({
  answer: jest.fn(),
  resolveDefaultModel: jest.fn(() => 'llama3.2'),
  parseRememberCommand: jest.fn(() => null),
}));

jest.mock('../../memory/companion-memory', () => ({
  isMemoryEnabled: jest.fn(() => true),
  recall: jest.fn(),
  writeMemory: jest.fn(),
  getContext: jest.fn(),
  writeTurn: jest.fn(),
}));

import { companionRouter } from '../../api/companion.ts';
import { verifyPortalToken, type PortalIdentity } from '../../auth/portal-token.ts';
import * as companionMemory from '../../memory/companion-memory.ts';

const mockedVerify = verifyPortalToken as jest.MockedFunction<typeof verifyPortalToken>;
const mockedWriteMemory = companionMemory.writeMemory as jest.MockedFunction<typeof companionMemory.writeMemory>;
const mockedIsMemoryEnabled = companionMemory.isMemoryEnabled as jest.MockedFunction<
  typeof companionMemory.isMemoryEnabled
>;

const OWNER: PortalIdentity = {
  subject: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 'owner@example.com',
  clientId: 'ci-mentra',
  claims: {},
};

const STRANGER: PortalIdentity = {
  subject: 'user-2',
  email: 'other@example.com',
  tenantId: 'other@example.com',
  claims: {},
};

const OWNER_TOKEN = 'owner-token';
const STRANGER_TOKEN = 'stranger-token';

let photoDir: string;

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser('test-secret'));
  app.use('/api/companion', companionRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-photos-'));
  mockConfig.companion.photoDir = photoDir;
  mockConfig.auth.owners = ['owner@example.com'];
  mockedIsMemoryEnabled.mockReturnValue(true);
  mockedWriteMemory.mockResolvedValue(true);
  mockedVerify.mockImplementation(async (token) => {
    if (token === OWNER_TOKEN) return OWNER;
    if (token === STRANGER_TOKEN) return STRANGER;
    return null;
  });
});

afterEach(() => {
  fs.rmSync(photoDir, { recursive: true, force: true });
});

const batch = [
  { id: 'a1', kind: 'speech', text: 'Remind me to call Sam', at: '2026-11-02T09:15:00.000Z' },
  { id: 'a2', kind: 'input', text: 'Glasses button: short press', at: '2026-11-02T09:16:00.000Z' },
];

describe('CI-Portal bearer on the companion API', () => {
  it('reports the owner as signed in from a Portal access token', async () => {
    const res = await request(makeApp())
      .get('/api/companion/status')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual({ sub: 'user-1', name: 'Owner', email: 'owner@example.com' });
  });

  it('reports a valid Portal token from someone else as not signed in', async () => {
    const res = await request(makeApp())
      .get('/api/companion/status')
      .set('Authorization', `Bearer ${STRANGER_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it('answers 401 to a token that fails verification', async () => {
    const res = await request(makeApp())
      .post('/api/companion/ask')
      .set('Authorization', 'Bearer not-a-token')
      .send({ text: 'hello' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/companion/capture', () => {
  it('refuses a request with no credential', async () => {
    const res = await request(makeApp()).post('/api/companion/capture').send({ records: batch });

    expect(res.status).toBe(401);
    expect(mockedWriteMemory).not.toHaveBeenCalled();
  });

  it('refuses a valid Portal token that belongs to someone else', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture')
      .set('Authorization', `Bearer ${STRANGER_TOKEN}`)
      .send({ records: batch });

    expect(res.status).toBe(401);
    expect(mockedWriteMemory).not.toHaveBeenCalled();
  });

  it('writes one memory fragment per record and reports the ids saved', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ records: batch });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ memoryEnabled: true, saved: ['a1', 'a2'], failed: [] });
    expect(mockedWriteMemory).toHaveBeenCalledTimes(2);
    expect(mockedWriteMemory).toHaveBeenNthCalledWith(
      1,
      'Remind me to call Sam',
      expect.objectContaining({
        title: 'Glasses speech, 2026-11-02 09:15 UTC',
        sessionId: 'companion:user-1:glasses',
      })
    );
  });

  it('lists the ids memory failed on, so the phone retries only those', async () => {
    mockedWriteMemory.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const res = await request(makeApp())
      .post('/api/companion/capture')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ records: batch });

    expect(res.body).toEqual({ memoryEnabled: true, saved: ['a1'], failed: ['a2'] });
  });

  it('stores nothing when memory is off, and says so', async () => {
    mockedIsMemoryEnabled.mockReturnValue(false);

    const res = await request(makeApp())
      .post('/api/companion/capture')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ records: batch });

    expect(res.body).toEqual({ memoryEnabled: false, saved: [], failed: [] });
    expect(mockedWriteMemory).not.toHaveBeenCalled();
  });

  it('rejects a batch with an unknown kind', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ records: [{ id: 'x1', kind: 'video', text: 'not a kind we take' }] });

    expect(res.status).toBe(400);
    expect(mockedWriteMemory).not.toHaveBeenCalled();
  });

  it('rejects an empty batch', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ records: [] });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/companion/capture/photo', () => {
  it('keeps the photo the glasses upload and notes it in memory', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture/photo')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .field('requestId', 'req-1')
      .attach('photo', Buffer.from('fake-jpeg-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(true);
    expect(res.body.fileName).toMatch(/-req-1\.jpg$/);
    const kept = path.join(photoDir, 'user-1', res.body.fileName);
    expect(fs.readFileSync(kept, 'utf8')).toBe('fake-jpeg-bytes');
    expect(mockedWriteMemory).toHaveBeenCalledWith(
      expect.stringContaining(res.body.fileName),
      expect.objectContaining({ title: expect.stringMatching(/^Glasses photo, /) })
    );
  });

  it('refuses an upload from someone else', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture/photo')
      .set('Authorization', `Bearer ${STRANGER_TOKEN}`)
      .field('requestId', 'req-2')
      .attach('photo', Buffer.from('fake-jpeg-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(401);
    expect(fs.readdirSync(photoDir)).toEqual([]);
  });

  it('requires a photo file', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture/photo')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .field('requestId', 'req-3');

    expect(res.status).toBe(400);
  });

  it('refuses a file that is not a supported image', async () => {
    const res = await request(makeApp())
      .post('/api/companion/capture/photo')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .attach('photo', Buffer.from('plain text'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(415);
    expect(fs.readdirSync(photoDir)).toEqual([]);
  });
});
