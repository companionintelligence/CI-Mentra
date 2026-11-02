/** Portal tokens the app keeps between launches. Times are epoch milliseconds. */
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/** Refresh this long before the access token expires, so a request never starts with a dead token. */
export const REFRESH_SKEW_MS = 60_000;

/** Used when the token response does not say how long the access token lasts. */
const DEFAULT_LIFETIME_S = 300;

/** The fields of a token response this app reads. `issuedAt` is epoch seconds, as the auth library reports it. */
export interface TokenResponseFields {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  issuedAt?: number;
}

export function tokensFromResponse(response: TokenResponseFields, now: number): StoredTokens {
  const issuedAt = typeof response.issuedAt === 'number' && response.issuedAt > 0 ? response.issuedAt * 1000 : now;
  const lifetime = (typeof response.expiresIn === 'number' ? response.expiresIn : DEFAULT_LIFETIME_S) * 1000;
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken || undefined,
    expiresAt: issuedAt + lifetime,
  };
}

/** True when the access token should be refreshed before it is used. */
export function needsRefresh(tokens: StoredTokens, now: number): boolean {
  return tokens.expiresAt - now <= REFRESH_SKEW_MS;
}

/** Rebuild tokens from the three secure-store entries, or null when they do not form a usable set. */
export function parseStoredTokens(entries: {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: string | null;
}): StoredTokens | null {
  const expiresAt = Number(entries.expiresAt);
  if (!entries.accessToken || !Number.isFinite(expiresAt) || expiresAt <= 0) {
    return null;
  }
  return {
    accessToken: entries.accessToken,
    refreshToken: entries.refreshToken || undefined,
    expiresAt,
  };
}
