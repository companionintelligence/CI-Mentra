import worker, { type Env } from '../worker';
import { CONTENT_SECURITY_POLICY, IMAGE_CACHE, IMMUTABLE_CACHE } from '../headers';

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

  it.each(['/404', '/404.html'])('answers %s with a real 404 status, not a soft 404', async (path) => {
    const e = env();
    const res = await worker.fetch(new Request(`https://mentra.ci.computer${path}`), e);
    expect(res.status).toBe(404);
    expect(e.calls).toEqual(['/404']);
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
  });

  it('keeps scripts same-origin plus the two analytics hosts, with no inline script or style', () => {
    expect(CONTENT_SECURITY_POLICY).toContain(
      "script-src 'self' https://www.googletagmanager.com https://static.cloudflareinsights.com;"
    );
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self';");
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-inline');
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  describe('indexing', () => {
    it.each(['/api/auth/me', '/api/companion/status', '/healthz'])('marks %s noindex', async (path) => {
      const res = await worker.fetch(new Request(`https://mentra.ci.computer${path}`), env());
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it.each(['/brand/SHA256SUMS', '/app/brand/.version'])('marks static %s noindex', async (path) => {
      const res = await worker.fetch(new Request(`https://mentra.ci.computer${path}`), env());
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it.each(['/', '/app/', '/sitemap.xml'])('leaves %s indexable', async (path) => {
      const res = await worker.fetch(new Request(`https://mentra.ci.computer${path}`), env());
      expect(res.headers.get('x-robots-tag')).toBeNull();
    });
  });

  describe('caching', () => {
    function assetEnv(contentType: string, status = 200): Env {
      return {
        SITE_VERSION: 'test',
        ASSETS: {
          async fetch() {
            return new Response('x', {
              status,
              headers: { 'content-type': contentType, 'cache-control': 'public, max-age=0, must-revalidate' },
            });
          },
        },
      };
    }
    const cache = async (path: string, type: string, status = 200) =>
      (await worker.fetch(new Request(`https://mentra.ci.computer${path}`), assetEnv(type, status))).headers.get('cache-control');

    it('caches fingerprinted CSS and JS as immutable', async () => {
      expect(await cache('/site.css?v=11b0de49ef', 'text/css')).toBe(IMMUTABLE_CACHE);
      expect(await cache('/app/app.js?v=0123456789abcdef', 'text/javascript')).toBe(IMMUTABLE_CACHE);
    });

    it('does not trust an unfingerprinted or malformed version', async () => {
      expect(await cache('/site.css', 'text/css')).toBe('public, max-age=0, must-revalidate');
      expect(await cache('/site.css?v=latest', 'text/css')).toBe('public, max-age=0, must-revalidate');
      expect(await cache('/site.css?v=zz', 'text/css')).toBe('public, max-age=0, must-revalidate');
    });

    it('caches images and icons for a day', async () => {
      expect(await cache('/icon-192.png', 'image/png')).toBe(IMAGE_CACHE);
      expect(await cache('/favicon.ico', 'image/x-icon')).toBe(IMAGE_CACHE);
      expect(await cache('/og.png', 'image/png')).toBe(IMAGE_CACHE);
    });

    it('keeps HTML, sitemap, robots and the manifest revalidating, and never caches errors', async () => {
      const revalidate = 'public, max-age=0, must-revalidate';
      expect(await cache('/', 'text/html; charset=utf-8')).toBe(revalidate);
      expect(await cache('/app/', 'text/html; charset=utf-8')).toBe(revalidate);
      expect(await cache('/sitemap.xml', 'application/xml')).toBe(revalidate);
      expect(await cache('/robots.txt', 'text/plain')).toBe(revalidate);
      expect(await cache('/site.webmanifest', 'application/manifest+json')).toBe(revalidate);
      expect(await cache('/missing.png', 'image/png', 404)).toBe(revalidate);
    });

    it('leaves the demo API and /healthz at no-store', async () => {
      const api = await worker.fetch(new Request('https://mentra.ci.computer/api/companion/status'), env());
      expect(api.headers.get('cache-control')).toBe('no-store');
      const health = await worker.fetch(new Request('https://mentra.ci.computer/healthz'), env());
      expect(health.headers.get('cache-control')).toBe('no-store');
    });
  });
});
