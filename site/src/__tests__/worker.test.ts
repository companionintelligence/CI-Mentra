import worker, { type Env } from '../worker';
import { CONTENT_SECURITY_POLICY } from '../headers';

function env(): Env & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    SITE_VERSION: 'test',
    ASSETS: {
      async fetch(request: Request) {
        calls.push(new URL(request.url).pathname);
        return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
      },
    },
  };
}

describe('site worker', () => {
  it('serves /healthz itself', async () => {
    const e = env();
    const res = await worker.fetch(new Request('https://mentra.ci.computer/healthz'), e);
    expect(await res.json()).toEqual({ status: 'ok', service: 'ci-mentra-site', version: 'test' });
    expect(e.calls).toEqual([]);
  });

  it('routes /api/* to the demo BFF, not assets', async () => {
    const e = env();
    const res = await worker.fetch(new Request('https://mentra.ci.computer/api/companion/status'), e);
    expect((await res.json()).demo).toBe(true);
    expect(e.calls).toEqual([]);
  });

  it('falls through to static assets and adds security headers', async () => {
    const e = env();
    const res = await worker.fetch(new Request('https://mentra.ci.computer/app/'), e);
    expect(e.calls).toEqual(['/app/']);
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-type')).toBe('text/html');
  });

  it('keeps scripts same-origin only', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
});
