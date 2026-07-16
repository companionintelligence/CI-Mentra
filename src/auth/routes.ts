import { Router, type Request, type Response } from 'express';
import { config } from '../config';
import {
  discover,
  pkcePair,
  randomToken,
  authorizationUrl,
  exchangeCode,
  verifyIdToken,
  fetchUserInfo,
  toUserClaims,
  endSessionUrl,
  type OidcConfig,
} from './oidc';
import { createSession, getSession, destroySession, SESSION_COOKIE } from './sessions';
import pino from 'pino';

const logger = pino({ name: 'oidc-login' });

export const TX_COOKIE = 'mentra_oidc_tx';
const TX_MAX_AGE_MS = 10 * 60 * 1000; // 10 min to complete the round-trip

interface LoginTx {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  returnTo: string;
}

export function encodeTx(tx: LoginTx): string {
  return Buffer.from(JSON.stringify(tx), 'utf8').toString('base64url');
}

export function decodeTx(raw: string | undefined): LoginTx | null {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as LoginTx;
  } catch {
    return null;
  }
}

function oidcConfig(): OidcConfig {
  return {
    issuer: config.auth.oidc.issuer,
    clientId: config.auth.oidc.clientId,
    clientSecret: config.auth.oidc.clientSecret || undefined,
    scopes: config.auth.oidc.scopes,
  };
}

function isHttps(req: Request): boolean {
  return req.secure || (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() === 'https';
}

function cookieOpts(req: Request, maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isHttps(req),
    signed: true,
    maxAge: maxAgeMs,
    path: '/',
  };
}

function redirectUriFor(req: Request): string {
  if (config.auth.oidc.redirectUri) return config.auth.oidc.redirectUri;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/auth/callback`;
}

/** Only allow same-site relative return paths, never an open redirect. */
function safeReturnTo(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : '';
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function sessionIdFrom(req: Request): string | undefined {
  return (req.signedCookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
}

function fail(res: Response, message: string, status = 400): void {
  res.status(status).type('text/plain').send(`Login failed: ${message}`);
}

export const authRouter = Router();

// Public: lets a UI discover whether login is available and where to start it.
authRouter.get('/config', (_req, res) => {
  const oidc = config.auth.oidc;
  res.json({
    enabled: oidc.enabled,
    providerName: oidc.providerName,
    clientId: oidc.clientId,
    issuer: oidc.issuer,
    loginUrl: '/api/auth/login',
  });
});

// Begin Authorization Code + PKCE.
authRouter.get('/login', async (req, res) => {
  if (!config.auth.oidc.enabled) {
    fail(res, 'OIDC login is disabled (set MENTRA_OIDC_ENABLED=true)', 503);
    return;
  }
  try {
    const cfg = oidcConfig();
    const doc = await discover(cfg.issuer);
    const { verifier, challenge } = pkcePair();
    const state = randomToken(24);
    const nonce = randomToken(24);
    const redirectUri = redirectUriFor(req);
    const tx: LoginTx = { state, nonce, verifier, redirectUri, returnTo: safeReturnTo(req.query.return_to) };
    res.cookie(TX_COOKIE, encodeTx(tx), cookieOpts(req, TX_MAX_AGE_MS));
    res.redirect(authorizationUrl(doc, cfg, { redirectUri, state, nonce, codeChallenge: challenge }));
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to start OIDC login');
    fail(res, 'could not reach the identity provider', 502);
  }
});

// Exchange the code, verify the id_token, establish a session.
authRouter.get('/callback', async (req, res) => {
  if (!config.auth.oidc.enabled) {
    fail(res, 'OIDC login is disabled', 503);
    return;
  }
  const tx = decodeTx((req.signedCookies as Record<string, string> | undefined)?.[TX_COOKIE]);
  res.clearCookie(TX_COOKIE, { path: '/' });

  const query = req.query as Record<string, string | undefined>;
  if (query.error) {
    fail(res, query.error_description || query.error);
    return;
  }
  if (!tx) {
    fail(res, 'login session expired — please try again');
    return;
  }
  if (!query.code || query.state !== tx.state) {
    fail(res, 'invalid login response (state mismatch)');
    return;
  }

  try {
    const cfg = oidcConfig();
    const doc = await discover(cfg.issuer);
    const tokens = await exchangeCode(doc, cfg, {
      code: query.code,
      redirectUri: tx.redirectUri,
      codeVerifier: tx.verifier,
    });
    if (!tokens.id_token) {
      fail(res, 'no id_token returned by the provider');
      return;
    }
    const idClaims = await verifyIdToken(doc, cfg, tokens.id_token, tx.nonce);
    const enriched = await fetchUserInfo(doc, tokens.access_token).catch(() => null);
    const user = toUserClaims({ ...idClaims, ...(enriched || {}) });

    const session = createSession(user, tokens, config.auth.oidc.sessionTtlMs);
    res.cookie(SESSION_COOKIE, session.id, cookieOpts(req, config.auth.oidc.sessionTtlMs));
    logger.info({ sub: user.sub, email: user.email }, 'OIDC login succeeded');
    res.redirect(tx.returnTo || '/');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'OIDC callback failed');
    fail(res, (err as Error).message);
  }
});

// Who is logged in on this session?
authRouter.get('/me', (req, res) => {
  const session = getSession(sessionIdFrom(req));
  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, user: session.user });
});

// End the session (local) and, if supported, RP-initiated logout at the provider.
authRouter.all('/logout', async (req, res) => {
  const sid = sessionIdFrom(req);
  const session = getSession(sid);
  const idTokenHint = session?.tokens.id_token;
  destroySession(sid);
  res.clearCookie(SESSION_COOKIE, { path: '/' });

  const postLogout = config.auth.oidc.postLogoutRedirectUri || undefined;
  if (config.auth.oidc.enabled) {
    try {
      const doc = await discover(oidcConfig().issuer);
      const url = endSessionUrl(doc, { idTokenHint, postLogoutRedirectUri: postLogout });
      if (url) {
        res.redirect(url);
        return;
      }
    } catch {
      // fall through to a local redirect
    }
  }
  res.redirect(postLogout || '/');
});
