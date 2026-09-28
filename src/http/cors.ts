import type express from 'express';

/**
 * Wildcard CORS, scoped to the OpenAI-compatible facade (`/v1`) ONLY.
 *
 * `/v1` is a bearer-token API for webviews: a cross-origin page can only call
 * it if it already holds a token, and `Access-Control-Allow-Origin: *` forbids
 * credentialed (cookie-bearing) requests by definition. Wildcard is correct there.
 *
 * `/api/*` — the companion BFF and the auth routes — is the opposite: it is
 * same-origin and authenticated by the session COOKIE. Sending ACAO `*` there
 * let any website the wearer happens to visit `fetch()`
 * `http://localhost:<port>/api/companion/profile` and *read the response body*,
 * because the wildcard is what grants the read. With MENTRA_DEV_ALLOW_ANONYMOUS
 * on, that response is the wearer's entire private memory, no credentials
 * needed. Omitting the header makes the browser withhold the response.
 *
 * Exported (rather than inlined into `main`) so the scoping is testable without
 * booting a server.
 */
export function applyFacadeCors(app: express.Application): void {
  app.use('/v1', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

/** The hosted setup page (mentra.ci.computer) probes a bridge's /health from the browser. */
export const DEFAULT_SETUP_ORIGINS = ['https://mentra.ci.computer'];

export function parseSetupOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return DEFAULT_SETUP_ORIGINS;
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => /^https?:\/\/[^/\s]+$/i.test(o));
}

/**
 * CORS for `GET /health` ONLY, and only for allowlisted origins.
 *
 * /health is unauthenticated and already readable by anything that can reach
 * the port; this just lets the setup page at mentra.ci.computer show the result.
 * An exact-origin allowlist (not `*`) keeps random sites from fingerprinting a
 * wearer's bridge, and the cookie-authenticated `/api/*` surface is untouched.
 * `Access-Control-Allow-Private-Network` lets Chrome's Private Network Access
 * preflight through when the bridge lives on localhost or a LAN address.
 */
export function applySetupCors(app: express.Application, origins: string[]): void {
  const allowed = new Set(origins);
  app.use('/health', (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) {
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      res.setHeader('Access-Control-Max-Age', '600');
      res.sendStatus(204);
      return;
    }
    next();
  });
}
