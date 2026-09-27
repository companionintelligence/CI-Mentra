/**
 * mentra.ci.computer — Cloudflare Worker entry.
 *
 *   /          setup guide + env generator + bridge health check (static)
 *   /app/      the companion UI from `public/`, running against the demo BFF
 *   /api/*     demo BFF (see ./demo.ts) — canned, stateless, no proxying
 *   /healthz   liveness for the site itself
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
        })
      );
    }

    const api = await handleDemoApi(request);
    if (api) return withSecurityHeaders(api);

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
