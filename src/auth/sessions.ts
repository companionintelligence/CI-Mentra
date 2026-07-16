import { randomToken, type TokenSet, type UserClaims } from './oidc';

/** Name of the signed cookie carrying the opaque session id. */
export const SESSION_COOKIE = 'mentra_session';

/**
 * Server-side session for an interactive OIDC login. Tokens are held here and
 * never exposed to the browser — the browser only carries the opaque session id
 * in the signed `mentra_session` cookie. Mirrors CI-Import-Tools' session
 * model, but in-memory (CI-Mentra is a single-instance bridge). Sessions do not
 * survive a restart.
 */
export interface SessionRecord {
  id: string;
  user: UserClaims;
  tokens: TokenSet;
  createdAt: number;
  expiresAt: number;
  /** Absolute expiry of the current access token, if known. */
  accessExpiresAt?: number;
}

const sessions = new Map<string, SessionRecord>();

function accessExpiry(tokens: TokenSet, now: number): number | undefined {
  return typeof tokens.expires_in === 'number' ? now + tokens.expires_in * 1000 : undefined;
}

export function createSession(user: UserClaims, tokens: TokenSet, ttlMs: number): SessionRecord {
  const now = Date.now();
  const record: SessionRecord = {
    id: randomToken(32),
    user,
    tokens,
    createdAt: now,
    expiresAt: now + ttlMs,
    accessExpiresAt: accessExpiry(tokens, now),
  };
  sessions.set(record.id, record);
  return record;
}

export function getSession(id: string | undefined | null): SessionRecord | null {
  if (!id) return null;
  const record = sessions.get(id);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return record;
}

/** Replace a session's tokens after a refresh, preserving the refresh_token if a new one wasn't issued. */
export function updateSessionTokens(id: string, tokens: TokenSet): void {
  const record = sessions.get(id);
  if (!record) return;
  const now = Date.now();
  record.tokens = { ...record.tokens, ...tokens, refresh_token: tokens.refresh_token || record.tokens.refresh_token };
  record.accessExpiresAt = accessExpiry(record.tokens, now);
}

export function destroySession(id: string | undefined | null): void {
  if (id) sessions.delete(id);
}

export function sessionCount(): number {
  return sessions.size;
}

/** Test/maintenance helper: drop all sessions. */
export function clearAllSessions(): void {
  sessions.clear();
}
