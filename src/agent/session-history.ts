import { CanonicalMessage } from '../canonical/types';
import { config } from '../config';

/**
 * Short-term (in-session) memory: a rolling window of the last N turns plus a
 * cached long-term context block, keyed by sessionId. This is what makes the
 * assistant coherent across turns instead of answering each utterance blind.
 * In-memory and single-instance, matching the rest of CI-Mentra's session model.
 */
interface SessionState {
  messages: CanonicalMessage[];
  contextBlock?: string;
  contextAt?: number;
  contextTtlMs?: number;
  updatedAt: number;
}

const CONTEXT_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const sessions = new Map<string, SessionState>();

function maxMessages(): number {
  return Math.max(1, config.agent.maxHistoryTurns) * 2;
}

/**
 * Read without allocating. Reads must never create entries: `GET /history` takes
 * a caller-supplied session id, so a creating read would let anyone grow this
 * map one entry per request.
 */
function peek(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export function getState(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { messages: [], updatedAt: Date.now() };
    sessions.set(sessionId, state);
  }
  return state;
}

export function getHistory(sessionId: string): CanonicalMessage[] {
  return peek(sessionId)?.messages ?? [];
}

export function appendExchange(sessionId: string, userText: string, assistantText: string): void {
  // Opportunistic sweep: this is the only path that grows the map, so it is the
  // natural place to retire stale sessions without a timer.
  pruneSessions();
  const state = getState(sessionId);
  state.messages.push({ role: 'user', content: userText });
  state.messages.push({ role: 'assistant', content: assistantText });
  const cap = maxMessages();
  if (state.messages.length > cap) {
    state.messages = state.messages.slice(state.messages.length - cap);
  }
  state.updatedAt = Date.now();
}

/** Whether the cached context block is fresh enough to reuse. */
export function contextIsFresh(sessionId: string): boolean {
  const state = peek(sessionId);
  if (!state || typeof state.contextBlock !== 'string') return false;
  const ttl = state.contextTtlMs ?? CONTEXT_TTL_MS;
  return Date.now() - (state.contextAt || 0) < ttl;
}

/**
 * Cache the profile block. `ttlMs` lets the caller cache an *empty* block
 * briefly: an empty block can mean "no profile yet" or "CI-Server was down", and
 * pinning the latter for the full TTL would blank the wearer's profile for ten
 * minutes after a momentary blip.
 */
export function setContext(sessionId: string, block: string, ttlMs: number = CONTEXT_TTL_MS): void {
  const state = getState(sessionId);
  state.contextBlock = block;
  state.contextAt = Date.now();
  state.contextTtlMs = ttlMs;
}

export function getContextBlock(sessionId: string): string {
  return peek(sessionId)?.contextBlock || '';
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Drop sessions older than the TTL (called opportunistically). */
export function pruneSessions(now = Date.now()): void {
  for (const [id, state] of sessions) {
    if (now - state.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

/** Test helper. */
export function resetSessions(): void {
  sessions.clear();
}
