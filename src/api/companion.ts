import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { config } from '../config.ts';
import {
  requireCompanionAuth,
  resolveCompanionIdentity,
  type CompanionRequest,
} from '../middleware/companion-auth.ts';
import * as answerService from '../agent/answer-service.ts';
import * as companionMemory from '../memory/companion-memory.ts';
import * as sessionHistory from '../agent/session-history.ts';
import pino from 'pino';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const logger = pino({ name: 'companion-api' });

/**
 * Backend-for-frontend for the companion UI (ring + phone webviews). It exists
 * so the browser never holds a memory API key or an inference endpoint: the UI
 * calls these cookie-authenticated routes and the server fans out to Companion
 * Memory + the answer service on its behalf.
 */
export const companionRouter: Router = Router();

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
  handle('status', async (req, res) => {
    const identity = await resolveCompanionIdentity(req);
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

const CAPTURE_KINDS = ['speech', 'input', 'device', 'photo'] as const;
type CaptureKind = (typeof CAPTURE_KINDS)[number];

const CAPTURE_TITLES: Record<CaptureKind, string> = {
  speech: 'Glasses speech',
  input: 'Glasses input',
  device: 'Glasses status',
  photo: 'Glasses photo',
};

const CAPTURE_MAX_RECORDS = 100;
const CAPTURE_MAX_TEXT = 1000;
const CAPTURE_WRITE_CONCURRENCY = 4;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface CaptureRecord {
  id: string;
  kind: CaptureKind;
  text: string;
  at: string;
}

/** Keep a client-supplied value safe to use as one path segment. */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'unknown';
}

/**
 * Validate a capture batch. Returns null when the batch is unusable (the
 * request is answered 400). Every field is checked here and not trusted past
 * this point.
 */
function parseCaptureRecords(value: unknown): CaptureRecord[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > CAPTURE_MAX_RECORDS) {
    return null;
  }
  const records: CaptureRecord[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { id, kind, text, at } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(id)) return null;
    if (typeof kind !== 'string' || !(CAPTURE_KINDS as readonly string[]).includes(kind)) return null;
    if (typeof text !== 'string' || !text.trim()) return null;
    const stamp = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
    records.push({
      id,
      kind: kind as CaptureKind,
      text: text.trim().slice(0, CAPTURE_MAX_TEXT),
      at: stamp.toISOString(),
    });
  }
  return records;
}

/** A memory title such as "Glasses speech, 2026-11-02 09:15 UTC". */
function captureTitle(kind: CaptureKind, at: string): string {
  return `${CAPTURE_TITLES[kind]}, ${at.slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Glasses data from the phone app, in batches. Each record becomes one memory
 * fragment titled by its kind and time. The reply lists the ids that were saved
 * and the ids memory failed on, so the phone clears only what was stored and
 * retries the rest. With memory off, nothing is stored and the phone is told.
 */
companionRouter.post(
  '/capture',
  handle('capture', async (req, res) => {
    const { userId } = req as CompanionRequest;
    const records = parseCaptureRecords(bodyOf(req).records);
    if (records === null) {
      badRequest(
        res,
        '`records` must be an array of 1 to 100 objects, each with an `id`, a `kind` (speech, input, device or photo) and non-empty `text`.'
      );
      return;
    }
    if (!companionMemory.isMemoryEnabled()) {
      res.json({ memoryEnabled: false, saved: [], failed: [] });
      return;
    }

    const sessionId = scopedSessionId(userId, 'glasses');
    const saved: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < records.length; i += CAPTURE_WRITE_CONCURRENCY) {
      const chunk = records.slice(i, i + CAPTURE_WRITE_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((record) =>
          companionMemory.writeMemory(record.text, { title: captureTitle(record.kind, record.at), sessionId })
        )
      );
      chunk.forEach((record, index) => (results[index] ? saved : failed).push(record.id));
    }
    res.json({ memoryEnabled: true, saved, failed });
  })
);

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
});

/**
 * A photo the phone asked the glasses to take. The SDK uploads it as multipart
 * form data (a `photo` file and a `requestId`) with the phone's bearer token, so
 * it passes the same owner check as everything else. The file is kept under
 * COMPANION_PHOTO_DIR and noted in memory.
 */
companionRouter.post(
  '/capture/photo',
  photoUpload.single('photo'),
  handle('capture/photo', async (req, res) => {
    const { userId } = req as CompanionRequest;
    const file = (req as Request & { file?: { buffer: Buffer; size: number; mimetype: string } }).file;
    if (!file || file.size === 0) {
      badRequest(res, 'A `photo` file is required.');
      return;
    }
    const extension = PHOTO_EXTENSIONS[file.mimetype];
    if (!extension) {
      res.status(415).json({ error: { message: 'Photos must be JPEG, PNG or WebP.', type: 'invalid_request_error' } });
      return;
    }

    const requestId = readOptionalString(bodyOf(req).requestId) ?? `photo-${Date.now()}`;
    const now = new Date().toISOString();
    const name = `${now.replace(/[:.]/g, '-')}-${safeSegment(requestId)}.${extension}`;
    const dir = path.join(config.companion.photoDir, safeSegment(userId));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, name), file.buffer, { mode: 0o600 });

    const noted = await companionMemory.writeMemory(
      `A photo from your glasses was saved on this appliance as ${name}.`,
      { title: captureTitle('photo', now), sessionId: scopedSessionId(userId, 'glasses') }
    );
    res.json({
      stored: true,
      fileName: name,
      contentType: file.mimetype,
      fileSizeBytes: file.size,
      memorySaved: noted,
    });
  })
);
