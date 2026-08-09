import axios from 'axios';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'companion-memory' });

/**
 * Client for Companion Memory (CI-Server's agent memory API). Mirrors how the
 * Hermes/OpenClaw `companionintelligence` plugins (and CI-Even-Realities'
 * agent-hub) integrate:
 *   - GET  <prefix>/memory/context   — L0 profile block for the system prompt
 *   - POST <prefix>/memory/recall    — hybrid pgvector RAG, returns a prompt block
 *   - POST <prefix>/memory/turn      — persist a conversation turn (idempotent)
 *   - POST <prefix>/memory/write     — store a durable memory fragment
 *
 * `<prefix>` is `config.memory.pathPrefix` (default `/api`) — see the config.ts
 * doc comment for why this must be configurable rather than hardcoded.
 *
 * Auth is an `x-api-key` memory-scoped key (NOT the Portal OIDC bearer — those
 * routes are ApiKeyGuard-only). Every call is FAIL-OPEN: on any error the
 * assistant still works, just without memory.
 */

export interface MemoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RecallResult {
  block: string;
  resultCount: number;
}

const MESSAGE_MAX_CHARS = 4000;

function enabled(): boolean {
  return config.memory.enabled && Boolean(config.memory.apiKey);
}

function client() {
  return axios.create({
    baseURL: config.memory.baseUrl,
    headers: { 'x-api-key': config.memory.apiKey, 'Content-Type': 'application/json' },
    timeout: 8000,
  });
}

function memoryPath(path: string): string {
  return `${config.memory.pathPrefix}/memory/${path}`;
}

function clampContent(content: string): string {
  return content.length > MESSAGE_MAX_CHARS ? content.slice(0, MESSAGE_MAX_CHARS) : content;
}

/**
 * Extract a prompt-ready text block from a memory response, tolerant of minor
 * CI-Server surface drift: the canonical shape is `{ block }`, but older/other
 * deployments may answer with `{ context }` or a raw `{ results: [...] }`
 * array. Falls back through each in turn before giving up.
 */
function extractBlock(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const obj = data as {
    block?: unknown;
    context?: unknown;
    results?: Array<{ text?: unknown; content?: unknown; summary?: unknown }>;
  };
  if (typeof obj.block === 'string') return obj.block;
  if (typeof obj.context === 'string') return obj.context;
  if (Array.isArray(obj.results)) {
    return obj.results
      .map((r) => (typeof r.text === 'string' && r.text) || (typeof r.content === 'string' && r.content) || (typeof r.summary === 'string' && r.summary) || '')
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

/** L0 profile/context block for the system prompt. Empty string if unavailable. */
export async function getContext(): Promise<string> {
  if (!enabled()) return '';
  try {
    const resp = await client().get(memoryPath('context'));
    return extractBlock(resp.data);
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'memory context unavailable');
    return '';
  }
}

/** Retrieve relevant long-term memory for a query (pgvector RAG). */
export async function recall(query: string, maxResults?: number): Promise<RecallResult> {
  const empty: RecallResult = { block: '', resultCount: 0 };
  if (!enabled() || !query.trim()) return empty;
  try {
    const resp = await client().post(memoryPath('recall'), {
      query: query.slice(0, 2000),
      maxResults: maxResults ?? config.memory.recallMaxResults,
    });
    const data = resp.data as { resultCount?: unknown; results?: unknown[] };
    const resultCount =
      typeof data?.resultCount === 'number' ? data.resultCount : Array.isArray(data?.results) ? data.results.length : 0;
    return { block: extractBlock(resp.data), resultCount };
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'memory recall failed');
    return empty;
  }
}

/** Persist a conversation turn. Idempotent server-side; fire-and-forget here. */
export async function writeTurn(messages: MemoryMessage[], sessionId?: string): Promise<void> {
  if (!enabled() || messages.length === 0) return;
  try {
    await client().post(memoryPath('turn'), {
      messages: messages.map((m) => ({ role: m.role, content: clampContent(m.content) })),
      sessionId,
      platform: config.memory.platform,
    });
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'memory turn write failed');
  }
}

/** Store a durable memory fragment (e.g. an explicit "remember this"). */
export async function writeMemory(
  content: string,
  opts: { title?: string; source?: string; sessionId?: string } = {}
): Promise<boolean> {
  if (!enabled() || !content.trim()) return false;
  try {
    await client().post(memoryPath('write'), {
      content: content.slice(0, 10000),
      title: opts.title,
      source: opts.source || config.memory.platform,
      sessionId: opts.sessionId,
    });
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'memory write failed');
    return false;
  }
}

export function isMemoryEnabled(): boolean {
  return enabled();
}
