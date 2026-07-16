import { Router, type Request, type Response } from 'express';
import { config } from '../config';
import {
  requireCompanionAuth,
  resolveCompanionIdentity,
  type CompanionRequest,
} from '../middleware/companion-auth';
import * as answerService from '../agent/answer-service';
import * as companionMemory from '../memory/companion-memory';
import * as sessionHistory from '../agent/session-history';
import pino from 'pino';

const logger = pino({ name: 'companion-api' });

/**
 * Backend-for-frontend for the companion UI (ring + phone webviews). It exists
 * so the browser never holds a memory API key or an inference endpoint: the UI
 * calls these cookie-authenticated routes and the server fans out to Companion
 * Memory + the answer service on its behalf.
 */
export const companionRouter = Router();

/**
 * Namespace a session id under the caller.
 *
 * The rolling history store is a process-global map, so the client's session id
 * must NEVER be used as the key directly: any signed-in caller could then pass
 * someone else's id and read their conversation. Prefixing with the resolved
 * userId means a client-supplied id can only ever select among *its own*
 * sessions. The raw value is clamped and stripped of separators so it cannot
 * escape its namespace.
 */
function scopedSessionId(userId: string, raw?: string): string {
  const suffix = (raw || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128) || 'default';
  return `companion:${userId}:${suffix}`;
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: { message, type: 'invalid_request_error' } });
}

/**
 * Read a required non-empty string field, answering 400 and returning null when
 * it is absent or blank. Callers must return immediately on null.
 */
function readRequiredString(res: Response, value: unknown, field: string): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    badRequest(res, `\`${field}\` is required and must be a non-empty string.`);
    return null;
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readOptionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/**
 * Wrap an async handler so a rejected promise becomes a 500 JSON body instead of
 * an unhandled rejection that hangs the request (Express 4 does not await).
 */
function handle(route: string, fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response): void => {
    Promise.resolve(fn(req, res)).catch((err: unknown) => {
      logger.error({ err: (err as Error)?.message, route }, 'companion route failed');
      if (!res.headersSent) {
        res.status(500).json({ error: { message: 'Internal server error.', type: 'server_error' } });
      }
    });
  };
}

function bodyOf(req: Request): Record<string, unknown> {
  return (req.body as Record<string, unknown> | undefined) ?? {};
}

/**
 * PUBLIC on purpose: the UI calls this before it has a session to decide whether
 * to render the chat or a login gate, so it must answer 200 either way.
 */
companionRouter.get(
  '/status',
  handle('status', (req, res) => {
    const identity = resolveCompanionIdentity(req);
    res.json({
      authenticated: Boolean(identity),
      user: identity
        ? { sub: identity.user.sub, name: identity.user.name, email: identity.user.email }
        : null,
      memoryEnabled: companionMemory.isMemoryEnabled(),
      provider: config.providers?.default ?? '',
      model: answerService.resolveDefaultModel(),
      oidcEnabled: Boolean(config.auth?.oidc?.enabled),
      loginUrl: '/api/auth/login',
    });
  })
);

// Everything below this line requires an identity.
companionRouter.use(requireCompanionAuth);

companionRouter.post(
  '/ask',
  handle('ask', async (req, res) => {
    const { userId } = req as CompanionRequest;
    const body = bodyOf(req);
    const text = readRequiredString(res, body.text, 'text');
    if (text === null) return;

    const clientSessionId = readOptionalString(body.sessionId);
    const result = await answerService.answer({
      sessionId: scopedSessionId(userId, clientSessionId),
      userId,
      text,
    });

    res.json({
      answer: result.answer,
      remembered: result.remembered,
      usedRecallCount: result.usedRecallCount,
      usedContext: result.usedContext,
      // Echo the client's own id back — the internal scoped key is never exposed.
      sessionId: clientSessionId ?? 'default',
    });
  })
);

companionRouter.post(
  '/memory/search',
  handle('memory/search', async (req, res) => {
    const body = bodyOf(req);
    const query = readRequiredString(res, body.query, 'query');
    if (query === null) return;

    const result = await companionMemory.recall(query, readOptionalCount(body.maxResults));
    res.json({ block: result.block, resultCount: result.resultCount });
  })
);

companionRouter.post(
  '/memory/remember',
  handle('memory/remember', async (req, res) => {
    const { userId } = req as CompanionRequest;
    const body = bodyOf(req);
    const content = readRequiredString(res, body.content, 'content');
    if (content === null) return;

    const saved = await companionMemory.writeMemory(content, {
      title: readOptionalString(body.title),
      sessionId: scopedSessionId(userId),
    });
    res.json({ saved });
  })
);

companionRouter.get(
  '/profile',
  handle('profile', async (_req, res) => {
    res.json({ block: await companionMemory.getContext() });
  })
);

companionRouter.get(
  '/history',
  handle('history', (req, res) => {
    const { userId } = req as CompanionRequest;
    const sessionId = scopedSessionId(userId, readOptionalString(req.query.sessionId));
    const messages = sessionHistory.getHistory(sessionId).map((message) => ({
      role: message.role,
      content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    }));
    res.json({ messages });
  })
);
