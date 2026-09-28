import { handleDemoApi, demoAnswer, demoRecall, DEMO_PROFILE } from '../demo';

const ORIGIN = 'https://mentra.ci.computer';

function req(path: string, init?: RequestInit): Request {
  return new Request(ORIGIN + path, init);
}

function post(path: string, body: unknown): Request {
  return req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function jsonOf(res: Response | null): Promise<any> {
  expect(res).not.toBeNull();
  return (res as Response).json();
}

describe('handleDemoApi', () => {
  it('returns null for non-API paths so assets can serve them', async () => {
    expect(await handleDemoApi(req('/'))).toBeNull();
    expect(await handleDemoApi(req('/app/'))).toBeNull();
  });

  it('reports an authenticated demo status shaped like the real BFF', async () => {
    const body = await jsonOf(await handleDemoApi(req('/api/companion/status')));
    expect(body).toMatchObject({ authenticated: true, memoryEnabled: true, demo: true, loginUrl: '/api/auth/login' });
    expect(body.user.sub).toBe('demo');
  });

  it('answers /ask with the BFF response contract and echoes sessionId', async () => {
    const res = await handleDemoApi(post('/api/companion/ask', { text: 'Where did I park?', sessionId: 'abc' }));
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body).toEqual({
      answer: expect.stringContaining('level 3'),
      remembered: false,
      usedRecallCount: 1,
      usedContext: true,
      sessionId: 'abc',
    });
  });

  it('400s /ask without text, like the real BFF', async () => {
    const res = await handleDemoApi(post('/api/companion/ask', { text: '  ' }));
    expect(res!.status).toBe(400);
    expect((await res!.json()).error.type).toBe('invalid_request_error');
  });

  it('400s a non-JSON body and 413s an oversized one', async () => {
    const bad = await handleDemoApi(req('/api/companion/ask', { method: 'POST', body: '{nope' }));
    expect(bad!.status).toBe(400);
    const big = await handleDemoApi(post('/api/companion/ask', { text: 'x'.repeat(20_000) }));
    expect(big!.status).toBe(413);
  });

  it('serves memory search, remember, profile and history', async () => {
    const search = await jsonOf(await handleDemoApi(post('/api/companion/memory/search', { query: 'birthday' })));
    expect(search.resultCount).toBe(1);
    expect(search.block).toContain('14 March');

    const saved = await jsonOf(await handleDemoApi(post('/api/companion/memory/remember', { content: 'milk' })));
    expect(saved.saved).toBe(true);

    expect(await jsonOf(await handleDemoApi(req('/api/companion/profile')))).toEqual({ block: DEMO_PROFILE });
    expect(await jsonOf(await handleDemoApi(req('/api/companion/history?sessionId=x')))).toEqual({ messages: [] });
  });

  it('redirects auth entry points back into the demo instead of a real IdP', async () => {
    const login = await handleDemoApi(req('/api/auth/login?return_to=%2F'));
    expect(login!.status).toBe(302);
    expect(login!.headers.get('location')).toBe('/app/');
    const logout = await handleDemoApi(req('/api/auth/logout'));
    expect(logout!.headers.get('location')).toBe('/');
  });

  it('404s unknown API routes and 405s unsupported methods', async () => {
    expect((await handleDemoApi(req('/api/nope')))!.status).toBe(404);
    expect((await handleDemoApi(req('/api/companion/ask', { method: 'DELETE' })))!.status).toBe(405);
  });
});

describe('demoAnswer / demoRecall', () => {
  it('treats "remember …" as a memory write', () => {
    const r = demoAnswer('Remember that the gate code is 4412.');
    expect(r.remembered).toBe(true);
    expect(r.answer).toContain('the gate code is 4412');
  });

  it('falls back to a demo explanation', () => {
    expect(demoAnswer('what is the airspeed of a swallow').answer).toMatch(/demo/i);
  });

  it('bounds recall results', () => {
    expect(demoRecall('the', 100).resultCount).toBeLessThanOrEqual(10);
    expect(demoRecall('zzzzzz').resultCount).toBe(0);
  });
});
