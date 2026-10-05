/**
 * mentra.ci.computer — Cloudflare Worker entry.
 *
 *   /          setup guide + env generator + bridge health check (static)
 *   /app/      the companion UI from `public/`, running against the demo BFF
 *   /api/*     demo BFF (see ./demo.ts) — canned, stateless, no proxying
 *   /healthz   liveness for the site itself
 *   /404       the branded 404 page, always with a 404 status
 *
 * Static files come from the `ASSETS` binding (built into site/dist by
 * scripts/build-site.sh). `run_worker_first` is on so every response,
 * static or not, passes through `withSecurityHeaders`.
 */
import { handleDemoApi } from './demo';
import { withSecurityHeaders } from './headers';

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SITE_VERSION?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return withSecurityHeaders(
        new Response(JSON.stringify({ status: 'ok', service: 'ci-mentra-site', version: env.SITE_VERSION || 'dev' }), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        }),
        url
      );
    }

    // The branded 404 page is also a file (404.html). Asking for it by name must still be a real 404,
    // not a 200 (or a redirect to a 200) that search engines would treat as a page.
    if (url.pathname === '/404' || url.pathname === '/404.html') {
      const page = await env.ASSETS.fetch(new Request(new URL('/404', url), { headers: request.headers }));
      return withSecurityHeaders(new Response(page.body, { status: 404, headers: page.headers }), url);
    }

    const api = await handleDemoApi(request);
    if (api) return withSecurityHeaders(api, url);

    return withSecurityHeaders(await env.ASSETS.fetch(request), url);
  },
};
