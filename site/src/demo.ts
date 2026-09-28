/**
 * Demo Companion BFF for the hosted site (mentra.ci.computer/app/).
 *
 * The companion UI in `public/` talks to `/api/companion/*` and `/api/auth/*`
 * on its own origin. On the hosted site there is no bridge, no memory and no
 * wearer — so this module answers those routes with canned, stateless data.
 * It never reaches a model, never stores anything, and never proxies to a
 * user-supplied origin (an open proxy on a public domain would be a liability).
 *
 * Pure `Request -> Response` so it can be unit-tested without workerd.
 */

const MAX_BODY_BYTES = 16 * 1024;

export const DEMO_USER = { sub: 'demo', name: 'Demo wearer', email: null } as const;

export const DEMO_PROFILE = [
  'Name: Demo wearer',
  'Wears: Mentra Live glasses',
  'Prefers: short spoken answers, metric units',
  'This is sample profile context. On your own bridge it comes from Companion Memory (CI-Server).',
].join('\n');

const DEMO_MEMORIES = [
  'Parked on level 3 of the Market Street garage, near the elevators.',
  'Anna’s birthday is on 14 March — she likes dark chocolate.',
  'The Wi-Fi password at the studio is on the fridge, not in 1Password.',
  'Prefers the window seat on flights longer than two hours.',
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function error(status: number, message: string, type = 'invalid_request_error'): Response {
  return json({ error: { message, type } }, status);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_BODY_BYTES) return error(413, 'Request body too large.');
  let text: string;
  try {
    text = await request.text();
  } catch {
    return error(400, 'Could not read request body.');
  }
  if (text.length > MAX_BODY_BYTES) return error(413, 'Request body too large.');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return error(400, 'Body must be JSON.');
  }
}

function requiredString(body: Record<string, unknown>, field: string): string | Response {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    return error(400, `\`${field}\` is required and must be a non-empty string.`);
  }
  return value.trim();
}

const REMEMBER = /^(?:please\s+)?remember(?:\s+that)?\s+(.+)$/i;

/** Deterministic canned replies — enough to show the loop without a model. */
export function demoAnswer(text: string): { answer: string; remembered: boolean; usedRecallCount: number } {
  const t = text.trim();
  const remember = REMEMBER.exec(t);
  if (remember) {
    return {
      answer: `Got it — I'd remember that ${remember[1].replace(/[.!]+$/, '')}. (Demo: nothing is saved here; your own bridge writes it to Companion Memory.)`,
      remembered: true,
      usedRecallCount: 0,
    };
  }
  if (/\b(park|parked|car)\b/i.test(t)) {
    return { answer: 'You parked on level 3 of the Market Street garage, near the elevators.', remembered: false, usedRecallCount: 1 };
  }
  if (/\b(birthday|anna)\b/i.test(t)) {
    return { answer: 'Anna’s birthday is 14 March. She likes dark chocolate.', remembered: false, usedRecallCount: 1 };
  }
  if (/^(hi|hello|hey)\b/i.test(t)) {
    return { answer: 'Hi! This is the hosted demo of your companion. Try "where did I park?"', remembered: false, usedRecallCount: 0 };
  }
  if (/\b(what can you do|help|how does this work)\b/i.test(t)) {
    return {
      answer: 'On your glasses I answer out loud, recall what you told me before, and save things when you say "remember…". Set up your own bridge at mentra.ci.computer.',
      remembered: false,
      usedRecallCount: 0,
    };
  }
  return {
    answer: 'This is a demo, so I only know a few canned answers. Connect your own CI-Mentra bridge to talk to your real companion.',
    remembered: false,
    usedRecallCount: 0,
  };
}

export function demoRecall(query: string, maxResults = 4): { block: string; resultCount: number } {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const hits = DEMO_MEMORIES.filter((m) => words.some((w) => m.toLowerCase().includes(w))).slice(0, Math.max(1, Math.min(maxResults, 10)));
  return { block: hits.join('\n\n'), resultCount: hits.length };
}

function status(): Record<string, unknown> {
  return {
    authenticated: true,
    user: DEMO_USER,
    memoryEnabled: true,
    provider: 'demo',
    model: 'canned-replies',
    oidcEnabled: false,
    loginUrl: '/api/auth/login',
    demo: true,
  };
}

/**
 * Answer a demo API request, or return null when the path is not one of ours
 * (the caller then falls through to static assets / 404).
 */
export async function handleDemoApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (path === '/api/auth/config' && method === 'GET') {
    return json({ enabled: false, providerName: '', loginUrl: '/api/auth/login', demo: true });
  }
  if (path === '/api/auth/me' && method === 'GET') return json({ user: DEMO_USER, demo: true });
  // No real sign-in on the demo: bounce back into the app.
  if (path === '/api/auth/login' || path === '/api/auth/callback') return redirect('/app/');
  if (path === '/api/auth/logout') return redirect('/');

  if (!path.startsWith('/api/companion')) return path.startsWith('/api/') ? error(404, 'Not found.', 'not_found') : null;

  const route = path.slice('/api/companion'.length) || '/';

  if (method === 'GET') {
    if (route === '/status') return json(status());
    if (route === '/profile') return json({ block: DEMO_PROFILE });
    if (route === '/history') return json({ messages: [] });
    return error(404, 'Not found.', 'not_found');
  }

  if (method !== 'POST') return error(405, 'Method not allowed.');

  const body = await readJson(request);
  if (body instanceof Response) return body;

  if (route === '/ask') {
    const text = requiredString(body, 'text');
    if (text instanceof Response) return text;
    const reply = demoAnswer(text);
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId : 'default';
    return json({ ...reply, usedContext: true, sessionId });
  }
  if (route === '/memory/search') {
    const query = requiredString(body, 'query');
    if (query instanceof Response) return query;
    const max = typeof body.maxResults === 'number' && Number.isFinite(body.maxResults) ? Math.floor(body.maxResults) : undefined;
    return json(demoRecall(query, max));
  }
  if (route === '/memory/remember') {
    const content = requiredString(body, 'content');
    if (content instanceof Response) return content;
    // Report "saved" so the UI shows the happy path; nothing is persisted.
    return json({ saved: true, demo: true });
  }
  return error(404, 'Not found.', 'not_found');
}
