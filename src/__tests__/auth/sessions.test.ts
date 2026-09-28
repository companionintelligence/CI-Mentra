import {
  createSession,
  getSession,
  destroySession,
  updateSessionTokens,
  clearAllSessions,
  SESSION_COOKIE,
} from '../../auth/sessions.ts';

const USER = { sub: 'user-1', email: 'liam@ci.computer', name: 'Liam' };
const TOKENS = { access_token: 'at', id_token: 'it', refresh_token: 'rt', expires_in: 3600 };

beforeEach(clearAllSessions);

describe('session store', () => {
  it('exposes the session cookie name', () => {
    expect(SESSION_COOKIE).toBe('mentra_session');
  });

  it('creates and retrieves a session by id', () => {
    const s = createSession(USER, TOKENS, 60_000);
    expect(s.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.accessExpiresAt).toBeGreaterThan(Date.now());

    const got = getSession(s.id);
    expect(got?.user.email).toBe('liam@ci.computer');
    expect(got?.tokens.id_token).toBe('it');
  });

  it('returns null for missing or empty ids', () => {
    expect(getSession(undefined)).toBeNull();
    expect(getSession('nope')).toBeNull();
  });

  it('expires sessions past their TTL', () => {
    const s = createSession(USER, TOKENS, -1); // already expired
    expect(getSession(s.id)).toBeNull();
  });

  it('destroys a session', () => {
    const s = createSession(USER, TOKENS, 60_000);
    destroySession(s.id);
    expect(getSession(s.id)).toBeNull();
  });

  it('preserves the refresh_token when an update omits it', () => {
    const s = createSession(USER, TOKENS, 60_000);
    updateSessionTokens(s.id, { access_token: 'at2', expires_in: 1200 });
    const got = getSession(s.id);
    expect(got?.tokens.access_token).toBe('at2');
    expect(got?.tokens.refresh_token).toBe('rt'); // retained
  });
});
