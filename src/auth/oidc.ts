/*
 * OIDC relying-party helpers for the interactive Authorization Code + PKCE
 * login flow. Ported from CI-Import-Tools (backend/src/auth/oidc.ts).
 *
 * Standards-based and discovery-driven: no endpoint URLs are hardcoded —
 * everything comes from `<issuer>/.well-known/openid-configuration`. We verify
 * the returned id_token's signature against the issuer's JWKS (via jose) and
 * check issuer/audience/nonce, then optionally enrich claims from /userinfo.
 */
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/** The subset of app config the RP helpers need. */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export interface TokenSet {
  access_token: string;
  token_type?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface UserClaims {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1h
const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.randomBytes(bytes));
}

/** PKCE: a high-entropy verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;

  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${url} → HTTP ${res.status}`);
  }
  const doc = (await res.json()) as Discovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error('OIDC discovery document missing required endpoints');
  }
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

function jwks(doc: Discovery) {
  let set = jwksCache.get(doc.jwks_uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(doc.jwks_uri));
    jwksCache.set(doc.jwks_uri, set);
  }
  return set;
}

export function authorizationUrl(
  doc: Discovery,
  cfg: OidcConfig,
  args: { redirectUri: string; state: string; nonce: string; codeChallenge: string }
): string {
  const u = new URL(doc.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('scope', cfg.scopes);
  u.searchParams.set('state', args.state);
  u.searchParams.set('nonce', args.nonce);
  u.searchParams.set('code_challenge', args.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

function clientAuthHeaders(cfg: OidcConfig): Record<string, string> {
  if (!cfg.clientSecret) return {};
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

export async function exchangeCode(
  doc: Discovery,
  cfg: OidcConfig,
  args: { code: string; redirectUri: string; codeVerifier: string }
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: cfg.clientId,
    code_verifier: args.codeVerifier,
  });
  // Public clients (no secret) authenticate with client_id + PKCE in the body;
  // confidential clients use HTTP Basic.
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...clientAuthHeaders(cfg),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 300)}` : ''}`);
  }
  return (await res.json()) as TokenSet;
}

export async function refreshTokens(
  doc: Discovery,
  cfg: OidcConfig,
  refreshToken: string
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...clientAuthHeaders(cfg),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 300)}` : ''}`);
  }
  return (await res.json()) as TokenSet;
}

/** Verify id_token signature + iss/aud, and confirm the nonce we sent. */
export async function verifyIdToken(
  doc: Discovery,
  cfg: OidcConfig,
  idToken: string,
  expectedNonce: string
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, jwks(doc), {
    issuer: doc.issuer,
    audience: cfg.clientId,
  });
  if (payload.nonce !== expectedNonce) {
    throw new Error('OIDC nonce mismatch');
  }
  return payload;
}

export async function fetchUserInfo(
  doc: Discovery,
  accessToken: string
): Promise<Record<string, unknown> | null> {
  if (!doc.userinfo_endpoint) return null;
  const res = await fetch(doc.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/** Map raw OIDC claims to the small user shape the app stores/shows. */
export function toUserClaims(claims: Record<string, unknown>): UserClaims {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const name =
    str(claims.name) ||
    [str(claims.given_name), str(claims.family_name)].filter(Boolean).join(' ') ||
    str(claims.preferred_username) ||
    undefined;
  return {
    sub: String(claims.sub),
    name: name || undefined,
    email: str(claims.email),
    picture: str(claims.picture),
  };
}

/** Build the RP-initiated logout URL, if the provider supports it. */
export function endSessionUrl(
  doc: Discovery,
  args: { idTokenHint?: string; postLogoutRedirectUri?: string }
): string | undefined {
  if (!doc.end_session_endpoint) return undefined;
  const u = new URL(doc.end_session_endpoint);
  if (args.idTokenHint) u.searchParams.set('id_token_hint', args.idTokenHint);
  if (args.postLogoutRedirectUri) {
    u.searchParams.set('post_logout_redirect_uri', args.postLogoutRedirectUri);
  }
  return u.toString();
}
