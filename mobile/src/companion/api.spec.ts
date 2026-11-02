import { CompanionApiError, createCompanionApi } from './api';
import type { CaptureRecord } from './records';

type Call = { url: string; init: RequestInit };

/** A fake fetch that records each call and answers with the next scripted response. */
function scripted(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error('no scripted response left');
    }
    return next();
  }) as unknown as typeof fetch;
  return { fake, calls };
}

function json(status: number, body: unknown): () => Response {
  return () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const RECORD: CaptureRecord = { id: 'r1', kind: 'speech', at: '2026-11-02T09:15:00.000Z', text: 'hello' };

describe('createCompanionApi', () => {
  it('reads the status without a token when none is given', async () => {
    const { fake, calls } = scripted([json(200, { authenticated: false, user: null, memoryEnabled: true })]);
    const api = createCompanionApi({ baseUrl: 'https://ci.example.org/', fetch: fake });

    const status = await api.status();

    expect(status.authenticated).toBe(false);
    expect(calls[0].url).toBe('https://ci.example.org/api/companion/status');
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends the bearer token and a JSON body when asking the agent', async () => {
    const { fake, calls } = scripted([json(200, { answer: 'Four.', remembered: false, sessionId: 'glasses' })]);
    const api = createCompanionApi({ baseUrl: 'https://ci.example.org', fetch: fake });

    const reply = await api.ask('token-1', 'What time is it?', 'glasses');

    expect(reply.answer).toBe('Four.');
    expect(calls[0].url).toBe('https://ci.example.org/api/companion/ask');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: 'What time is it?', sessionId: 'glasses' });
  });

  it('posts a capture batch and returns which ids were saved', async () => {
    const { fake, calls } = scripted([json(200, { memoryEnabled: true, saved: ['r1'], failed: [] })]);
    const api = createCompanionApi({ baseUrl: 'https://ci.example.org', fetch: fake });

    const result = await api.capture('token-1', [RECORD]);

    expect(result.saved).toEqual(['r1']);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ records: [RECORD] });
  });

  it('turns an error body into a CompanionApiError carrying the appliance message', async () => {
    const { fake } = scripted([
      json(401, { error: { message: 'Not signed in.', type: 'authentication_error' } }),
    ]);
    const api = createCompanionApi({ baseUrl: 'https://ci.example.org', fetch: fake });

    await expect(api.capture('stale', [RECORD])).rejects.toMatchObject({ status: 401, message: 'Not signed in.' });
  });

  it('reports an unreachable appliance with status 0', async () => {
    const fake = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const api = createCompanionApi({ baseUrl: 'https://ci.example.org', fetch: fake });

    const failure = await api.status().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CompanionApiError);
    expect(failure).toMatchObject({ status: 0 });
  });

  it('names the photo webhook under the appliance origin', () => {
    const api = createCompanionApi({ baseUrl: 'https://ci.example.org/' });

    expect(api.photoUploadUrl()).toBe('https://ci.example.org/api/companion/capture/photo');
  });
});
