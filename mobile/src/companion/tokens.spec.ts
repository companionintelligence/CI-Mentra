import { needsRefresh, parseStoredTokens, REFRESH_SKEW_MS, tokensFromResponse } from './tokens';

const NOW = 1_800_000_000_000;

describe('tokensFromResponse', () => {
  it('counts the lifetime from the issue time reported in seconds', () => {
    const tokens = tokensFromResponse({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600, issuedAt: 1_800_000_000 }, NOW);

    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1_800_000_000_000 + 3_600_000 });
  });

  it('starts the clock now when the response has no issue time, and uses a default lifetime', () => {
    const tokens = tokensFromResponse({ accessToken: 'a' }, NOW);

    expect(tokens.expiresAt).toBe(NOW + 300_000);
    expect(tokens.refreshToken).toBeUndefined();
  });

  it('treats an empty refresh token as absent', () => {
    expect(tokensFromResponse({ accessToken: 'a', refreshToken: '', expiresIn: 60 }, NOW).refreshToken).toBeUndefined();
  });
});

describe('needsRefresh', () => {
  it('is false while the token has more than the skew left', () => {
    expect(needsRefresh({ accessToken: 'a', expiresAt: NOW + REFRESH_SKEW_MS + 1 }, NOW)).toBe(false);
  });

  it('is true at and inside the skew window', () => {
    expect(needsRefresh({ accessToken: 'a', expiresAt: NOW + REFRESH_SKEW_MS }, NOW)).toBe(true);
    expect(needsRefresh({ accessToken: 'a', expiresAt: NOW - 1 }, NOW)).toBe(true);
  });
});

describe('parseStoredTokens', () => {
  it('rebuilds a complete set', () => {
    expect(parseStoredTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: String(NOW) })).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: NOW,
    });
  });

  it('accepts a set without a refresh token', () => {
    expect(parseStoredTokens({ accessToken: 'a', refreshToken: null, expiresAt: String(NOW) })?.refreshToken).toBeUndefined();
  });

  it('returns null when the access token or expiry is missing or unreadable', () => {
    expect(parseStoredTokens({ accessToken: null, refreshToken: 'r', expiresAt: String(NOW) })).toBeNull();
    expect(parseStoredTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: null })).toBeNull();
    expect(parseStoredTokens({ accessToken: 'a', refreshToken: 'r', expiresAt: 'soon' })).toBeNull();
  });
});
