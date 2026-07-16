import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// Mutable so each test can flip a flag (dev anonymous, OIDC, facade key,
// owner allowlist) without re-importing the router.
const mockConfig = {
  providers: { default: 'ollama' },
  facade: { apiKey: '' },
  auth: { oidc: { enabled: false }, owners: [] as string[] },
  dev: { allowAnonymous: false },
  agent: { maxHistoryTurns: 8 },
  memory: { platform: 'mentra' },
};
jest.mock('../../config', () => ({ config: mockConfig }));

// Capture logger output so the "warn once, not per request" contract is
// actually asserted. The arrow defers reading `mockWarn` until call time, which
// is after jest has hoisted this factory above the imports.
jest.mock('pino', () => {
  const factory = () => ({
    warn: (...args: unknown[]) => mockWarn(...args),
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
  });
  return { __esModule: true, default: factory, pino: factory };
});
const mockWarn = jest.fn();

/** Warnings raised by the empty-owner-allowlist path. */
function openAccessWarnings(): unknown[][] {
  return mockWarn.mock.calls.filter((call) => String(call[1] ?? '').includes('MENTRA_ALLOWED_USERS is not set'));
}

// The BFF is a delegation layer: stub the agent + memory so these tests cover
// routing, auth gating and validation rather than inference or CI-Server.
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

import { companionRouter } from '../../api/companion';
import { answer } from '../../agent/answer-service';
import { recall, writeMemory, getContext } from '../../memory/companion-memory';
import { resetSessions, appendExchange } from '../../agent/session-history';
import { createSession, clearAllSessions, SESSION_COOKIE } from '../../auth/sessions';
import { resetOwnerWarning } from '../../middleware/companion-auth';
import { applyFacadeCors } from '../../index';

const mockedAnswer = answer as jest.MockedFunction<typeof answer>;
const mockedRecall = recall as jest.MockedFunction<typeof recall>;
const mockedWriteMemory = writeMemory as jest.MockedFunction<typeof writeMemory>;
const mockedGetContext = getContext as jest.MockedFunction<typeof getContext>;

const COOKIE_SECRET = 'test-secret';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(COOKIE_SECRET));
  app.use('/api/companion', companionRouter);
  return app;
}

/**
 * Mint a real OIDC session and return the signed `Cookie` header a browser
 * would send. Signing matches cookie-parser's format (`s:<value>.<hmac>`) so
 * these tests exercise the genuine cookie → session → identity path.
 */
function signedSessionCookie(user: { sub: string; name?: string; email?: string }): string {
  const session = createSession(user, { access_token: 'token' }, 60_000);
  const mac = crypto.createHmac('sha256', COOKIE_SECRET).update(session.id).digest('base64').replace(/=+$/, '');
  return `${SESSION_COOKIE}=${encodeURIComponent(`s:${session.id}.${mac}`)}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSessions();
  clearAllSessions();
  resetOwnerWarning();
  mockConfig.dev.allowAnonymous = false;
  mockConfig.facade.apiKey = '';
  mockConfig.auth.oidc.enabled = false;
  mockConfig.auth.owners = [];

  mockedAnswer.mockResolvedValue({
    answer: 'You have a standup at 9.',
    remembered: false,
    usedRecallCount: 2,
    usedContext: true,
  });
  mockedRecall.mockResolvedValue({ block: '## Memory\n- likes espresso', resultCount: 3 });
  mockedWriteMemory.mockResolvedValue(true);
  mockedGetContext.mockResolvedValue('## Profile\n- Liam');
});

describe('GET /api/companion/status', () => {
  it('answers 200 with authenticated:false when signed out (so the UI can gate)', async () => {
    const res = await request(makeApp()).get('/api/companion/status');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBeNull();
    expect(res.body.loginUrl).toBe('/api/auth/login');
  });

  it('reports the active provider, model and memory state', async () => {
    const res = await request(makeApp()).get('/api/companion/status');

    expect(res.body.provider).toBe('ollama');
    expect(res.body.model).toBe('llama3.2');
    expect(res.body.memoryEnabled).toBe(true);
    expect(res.body.oidcEnabled).toBe(false);
  });

  it('reports authenticated when dev anonymous access is on', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp()).get('/api/companion/status');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual({ sub: 'dev', name: 'Local dev' });
  });
});

describe('POST /api/companion/ask', () => {
  it('returns 401 without any credentials', async () => {
    const res = await request(makeApp()).post('/api/companion/ask').send({ text: 'hi' });

    expect(res.status).toBe(401);
    expect(res.body.error.type).toBe('authentication_error');
    expect(mockedAnswer).not.toHaveBeenCalled();
  });

  it('answers via the agent for a dev-anonymous caller', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp())
      .post('/api/companion/ask')
      .send({ text: "what's on my calendar?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      answer: 'You have a standup at 9.',
      remembered: false,
      usedRecallCount: 2,
      usedContext: true,
      sessionId: 'default',
    });
    // The internal key is namespaced under the caller; the client never sees it.
    expect(mockedAnswer).toHaveBeenCalledWith({
      sessionId: 'companion:dev:default',
      userId: 'dev',
      text: "what's on my calendar?",
    });
  });

  it('honors an explicit sessionId', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp())
      .post('/api/companion/ask')
      .send({ text: 'hi', sessionId: 'ring-42' });

    expect(res.body.sessionId).toBe('ring-42');
    expect(mockedAnswer).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'companion:dev:ring-42' }));
  });

  it('returns 400 for empty text', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp()).post('/api/companion/ask').send({ text: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe('invalid_request_error');
    expect(mockedAnswer).not.toHaveBeenCalled();
  });

  it('returns 500 JSON rather than hanging when the agent throws', async () => {
    mockConfig.dev.allowAnonymous = true;
    mockedAnswer.mockRejectedValue(new Error('provider exploded'));

    const res = await request(makeApp()).post('/api/companion/ask').send({ text: 'hi' });

    expect(res.status).toBe(500);
    expect(res.body.error.type).toBe('server_error');
  });
});

describe('POST /api/companion/memory/search', () => {
  it('returns the recall block and result count', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp())
      .post('/api/companion/memory/search')
      .send({ query: 'espresso', maxResults: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ block: '## Memory\n- likes espresso', resultCount: 3 });
    expect(mockedRecall).toHaveBeenCalledWith('espresso', 5);
  });

  it('returns 400 for an empty query', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp()).post('/api/companion/memory/search').send({ query: '' });

    expect(res.status).toBe(400);
    expect(mockedRecall).not.toHaveBeenCalled();
  });

  it('returns 401 without credentials', async () => {
    const res = await request(makeApp()).post('/api/companion/memory/search').send({ query: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/companion/memory/remember', () => {
  it('saves a durable memory fragment', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp())
      .post('/api/companion/memory/remember')
      .send({ content: 'My passport expires in March', title: 'Passport' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: true });
    expect(mockedWriteMemory).toHaveBeenCalledWith('My passport expires in March', {
      title: 'Passport',
      sessionId: 'companion:dev:default',
    });
  });

  it('reports saved:false when the memory write fails', async () => {
    mockConfig.dev.allowAnonymous = true;
    mockedWriteMemory.mockResolvedValue(false);

    const res = await request(makeApp())
      .post('/api/companion/memory/remember')
      .send({ content: 'anything' });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(false);
  });

  it('returns 400 for empty content', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp()).post('/api/companion/memory/remember').send({ content: '' });

    expect(res.status).toBe(400);
    expect(mockedWriteMemory).not.toHaveBeenCalled();
  });
});

describe('GET /api/companion/profile', () => {
  it('returns the L0 profile block', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp()).get('/api/companion/profile');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ block: '## Profile\n- Liam' });
  });

  it('returns 401 without credentials', async () => {
    const res = await request(makeApp()).get('/api/companion/profile');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/companion/history', () => {
  it('returns an empty message list for a fresh session', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp()).get('/api/companion/history');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [] });
  });
});

describe('facade key auth', () => {
  it('accepts the configured facade key as a service identity', async () => {
    mockConfig.facade.apiKey = 'service-key';
    const res = await request(makeApp())
      .post('/api/companion/ask')
      .set('Authorization', 'Bearer service-key')
      .send({ text: 'hi' });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('default');
    expect(mockedAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'companion:service:default', userId: 'service' })
    );
  });

  it('rejects a wrong bearer when a facade key is configured', async () => {
    mockConfig.facade.apiKey = 'service-key';
    const res = await request(makeApp())
      .post('/api/companion/ask')
      .set('Authorization', 'Bearer nope')
      .send({ text: 'hi' });

    expect(res.status).toBe(401);
  });

  it('does not allow any bearer through when no facade key is configured', async () => {
    const res = await request(makeApp())
      .post('/api/companion/ask')
      .set('Authorization', 'Bearer anything')
      .send({ text: 'hi' });

    expect(res.status).toBe(401);
  });
});

/**
 * Regression: the rolling history store is process-global, so a client-supplied
 * sessionId must be namespaced under the caller. Without that, any signed-in
 * caller could pass someone else's id and read their conversation.
 */
describe('session isolation', () => {
  it("does not let one caller read another caller's history via a crafted sessionId", async () => {
    // The dev identity's private history, under its real internal key.
    appendExchange('companion:dev:secret', 'my private question', 'my private answer');

    // A *different* identity (facade-key service client) goes looking for it.
    mockConfig.facade.apiKey = 'service-key';
    const app = makeApp();

    const guess = await request(app)
      .get('/api/companion/history?sessionId=secret')
      .set('Authorization', 'Bearer service-key');
    expect(guess.status).toBe(200);
    expect(guess.body.messages).toEqual([]);

    // Trying to escape the namespace with separators must also fail.
    const escape = await request(app)
      .get(`/api/companion/history?sessionId=${encodeURIComponent('companion:dev:secret')}`)
      .set('Authorization', 'Bearer service-key');
    expect(escape.status).toBe(200);
    expect(escape.body.messages).toEqual([]);
  });

  it("still returns the caller's own history for their own session id", async () => {
    appendExchange('companion:dev:mine', 'hello', 'hi there');
    mockConfig.dev.allowAnonymous = true;

    const res = await request(makeApp()).get('/api/companion/history?sessionId=mine');
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('scopes /ask under the caller and echoes back only the client id', async () => {
    mockConfig.dev.allowAnonymous = true;
    const res = await request(makeApp()).post('/api/companion/ask').send({ text: 'hi', sessionId: 'tab-1' });

    expect(res.status).toBe(200);
    expect(mockedAnswer).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'companion:dev:tab-1' }));
    expect(res.body.sessionId).toBe('tab-1');
  });
});

/**
 * Authentication is not authorization. PORTAL_OIDC_AUDIENCE accepts several
 * first-party client ids, so a valid Portal login only proves the caller has an
 * account somewhere in the org — not that they own THIS wearer's glasses.
 * `config.auth.owners` (MENTRA_ALLOWED_USERS) is the ownership check.
 */
describe('owner allowlist', () => {
  const owner = { sub: 'user_owner', name: 'Liam', email: 'liam@example.com' };
  const stranger = { sub: 'user_stranger', name: 'Someone Else', email: 'stranger@example.com' };

  it('allows any signed-in Portal user when the allowlist is empty (single-user default)', async () => {
    const res = await request(makeApp())
      .get('/api/companion/status')
      .set('Cookie', signedSessionCookie(owner));

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual(owner);
  });

  it('warns that access is open when the allowlist is empty', async () => {
    await request(makeApp()).get('/api/companion/status').set('Cookie', signedSessionCookie(owner));

    expect(openAccessWarnings()).toHaveLength(1);
    expect(String(openAccessWarnings()[0][1])).toContain('ANY user who can sign in to CI-Portal');
  });

  it('warns ONCE, not per request — a line on every call is noise, not signal', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/api/companion/status').set('Cookie', signedSessionCookie(owner));
      expect(res.body.authenticated).toBe(true);
    }

    expect(openAccessWarnings()).toHaveLength(1);
  });

  it('does not warn about open access once an allowlist is configured', async () => {
    mockConfig.auth.owners = ['liam@example.com'];

    await request(makeApp()).get('/api/companion/status').set('Cookie', signedSessionCookie(owner));

    expect(openAccessWarnings()).toHaveLength(0);
  });

  it('serves the owner when they are on the allowlist', async () => {
    mockConfig.auth.owners = ['liam@example.com'];

    const res = await request(makeApp())
      .get('/api/companion/profile')
      .set('Cookie', signedSessionCookie(owner));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ block: '## Profile\n- Liam' });
  });

  it('matches the owner email case-insensitively', async () => {
    mockConfig.auth.owners = ['liam@example.com'];

    const res = await request(makeApp())
      .get('/api/companion/status')
      .set('Cookie', signedSessionCookie({ ...owner, email: 'Liam@Example.COM' }));

    expect(res.body.authenticated).toBe(true);
  });

  it('matches on sub when the session carries no email', async () => {
    mockConfig.auth.owners = ['user_owner'];

    const res = await request(makeApp())
      .get('/api/companion/status')
      .set('Cookie', signedSessionCookie({ sub: 'user_owner', name: 'Liam' }));

    expect(res.body.authenticated).toBe(true);
  });

  it('reports authenticated:false to a signed-in NON-owner', async () => {
    mockConfig.auth.owners = ['liam@example.com'];

    const res = await request(makeApp())
      .get('/api/companion/status')
      .set('Cookie', signedSessionCookie(stranger));

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.user).toBeNull();
  });

  it("401s a signed-in non-owner reaching for the wearer's memory", async () => {
    mockConfig.auth.owners = ['liam@example.com'];
    const cookie = signedSessionCookie(stranger);
    const app = makeApp();

    const profile = await request(app).get('/api/companion/profile').set('Cookie', cookie);
    expect(profile.status).toBe(401);
    expect(mockedGetContext).not.toHaveBeenCalled();

    const search = await request(app)
      .post('/api/companion/memory/search')
      .set('Cookie', cookie)
      .send({ query: 'passport' });
    expect(search.status).toBe(401);
    expect(mockedRecall).not.toHaveBeenCalled();

    const ask = await request(app).post('/api/companion/ask').set('Cookie', cookie).send({ text: 'what do you know' });
    expect(ask.status).toBe(401);
    expect(mockedAnswer).not.toHaveBeenCalled();

    const remember = await request(app)
      .post('/api/companion/memory/remember')
      .set('Cookie', cookie)
      .send({ content: 'poison' });
    expect(remember.status).toBe(401);
    expect(mockedWriteMemory).not.toHaveBeenCalled();
  });

  it('leaves the facade-key path unaffected for a non-owner session', async () => {
    mockConfig.auth.owners = ['liam@example.com'];
    mockConfig.facade.apiKey = 'service-key';

    // A non-owner cookie must not *revoke* a separately valid service credential;
    // it simply carries no weight of its own.
    const res = await request(makeApp())
      .post('/api/companion/ask')
      .set('Cookie', signedSessionCookie(stranger))
      .set('Authorization', 'Bearer service-key')
      .send({ text: 'hi' });

    expect(res.status).toBe(200);
    expect(mockedAnswer).toHaveBeenCalledWith(expect.objectContaining({ userId: 'service' }));
  });

  it('leaves the dev-anonymous path unaffected for a non-owner session', async () => {
    mockConfig.auth.owners = ['liam@example.com'];
    mockConfig.dev.allowAnonymous = true;

    const res = await request(makeApp())
      .get('/api/companion/status')
      .set('Cookie', signedSessionCookie(stranger));

    // dev-anonymous is already open to callers with no cookie at all, so a
    // non-owner cookie can't make it worse — they get the same 'dev' identity.
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual({ sub: 'dev', name: 'Local dev' });
  });
});

/**
 * Finding 2: `Access-Control-Allow-Origin: *` was set on EVERY route. The
 * companion BFF is cookie-authenticated and same-origin, so the wildcard let
 * any site the wearer visited read /api/companion/profile — their whole memory —
 * straight out of the response body.
 */
describe('CORS scoping', () => {
  function makeCorsApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser(COOKIE_SECRET));
    applyFacadeCors(app); // exactly how src/index.ts wires it
    app.use('/api/companion', companionRouter);
    app.get('/v1/models', (_req, res) => {
      res.json({ object: 'list' });
    });
    return app;
  }

  it('sends wildcard CORS on the bearer-token facade', async () => {
    const res = await request(makeCorsApp()).get('/v1/models').set('Origin', 'https://webview.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
  });

  it('still answers the /v1 preflight with 204 before auth runs', async () => {
    const res = await request(makeCorsApp())
      .options('/v1/models')
      .set('Origin', 'https://webview.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('sends NO CORS header on the cookie-authenticated companion BFF', async () => {
    const res = await request(makeCorsApp())
      .get('/api/companion/status')
      .set('Origin', 'https://evil.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("does not let a hostile origin read the wearer's profile, even with dev-anonymous on", async () => {
    mockConfig.dev.allowAnonymous = true;

    const res = await request(makeCorsApp())
      .get('/api/companion/profile')
      .set('Origin', 'https://evil.example');

    // The server still answers (it can't tell a browser from curl), but without
    // ACAO the browser refuses to hand the body to the calling page.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
