import { type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.ts';
import { isPortalAuthEnabled, verifyPortalToken } from '../auth/portal-token.ts';
import { getSession, SESSION_COOKIE } from '../auth/sessions.ts';
import { isOwner } from '../auth/owners.ts';
import pino from 'pino';

const logger = pino({ name: 'auth' });

export type AuthMethod = 'oidc-session' | 'portal-oidc' | 'facade-key';

export interface AuthenticatedRequest extends Request {
  tenantId: string;
  userId: string;
  authMethod?: AuthMethod;
  email?: string;
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({
    error: {
      message,
      type: 'authentication_error',
      code: 'invalid_api_key',
    },
  });
}

function extractBearer(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

function matchesFacadeKey(token: string): boolean {
  // Empty configured key = allow all (dev default), preserving prior behavior.
  return !config.facade.apiKey || token === config.facade.apiKey;
}

/**
 * Authentication middleware for the OpenAI facade.
 *
 * Accepts an OIDC login session cookie, or a Bearer token that is either:
 *  1. A CI-Portal OIDC JWT (validated via JWKS) — when `PORTAL_OIDC_ENABLED`.
 *  2. The static `FACADE_API_KEY` — for machine/dev clients (and always when
 *     Portal auth is disabled, matching the original behavior).
 *
 * A session or Portal token counts only for an owner (MENTRA_ALLOWED_USERS),
 * as on the companion API; see `isOwner`. The static key is not affected.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 1. Interactive OIDC login session (signed cookie set by /api/auth/callback).
  //    A session that isn't an owner's carries no weight: the request goes on
  //    to the bearer checks below as if it had no cookie.
  const sid = (req.signedCookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const session = getSession(sid);
  if (session) {
    if (isOwner(session.user)) {
      const authReq = req as AuthenticatedRequest;
      authReq.tenantId = session.user.email || session.user.sub;
      authReq.userId = session.user.sub;
      authReq.email = session.user.email;
      authReq.authMethod = 'oidc-session';
      next();
      return;
    }
    logger.warn(
      { sub: session.user.sub, email: session.user.email, path: req.path },
      'Denying signed-in CI-Portal user: not in the MENTRA_ALLOWED_USERS owner allowlist'
    );
  }

  // 2. Bearer token: CI-Portal OIDC JWT or the static facade key.
  const token = extractBearer(req);
  if (!token) {
    unauthorized(res, 'Missing or invalid credentials. Provide a Bearer token or sign in at /api/auth/login.');
    return;
  }

  if (isPortalAuthEnabled()) {
    const identity = await verifyPortalToken(token);
    if (identity) {
      if (isOwner({ sub: identity.subject, email: identity.email })) {
        const authReq = req as AuthenticatedRequest;
        authReq.tenantId = identity.tenantId;
        authReq.userId = identity.subject || identity.tenantId;
        authReq.email = identity.email;
        authReq.authMethod = 'portal-oidc';
        next();
        return;
      }
      logger.warn(
        { sub: identity.subject, email: identity.email, path: req.path },
        'Denying CI-Portal bearer: not in the MENTRA_ALLOWED_USERS owner allowlist'
      );
    }

    // Not a valid Portal token, or not an owner's — allow an explicitly
    // configured static key through (service clients), otherwise reject.
    // Never fall back to allow-all while OIDC is the intended gate.
    if (config.facade.apiKey && token === config.facade.apiKey) {
      const authReq = req as AuthenticatedRequest;
      authReq.tenantId = 'service';
      authReq.userId = 'service';
      authReq.authMethod = 'facade-key';
      next();
      return;
    }

    logger.warn({ ip: req.ip }, 'Rejected token: not a valid Portal token or facade key');
    unauthorized(res, 'Invalid token. Provide a CI-Portal OIDC token or a valid API key.');
    return;
  }

  // Portal auth disabled: legacy static facade-key behavior.
  if (!matchesFacadeKey(token)) {
    logger.warn({ ip: req.ip }, 'Invalid API key attempt');
    unauthorized(res, 'Invalid API key.');
    return;
  }

  const authReq = req as AuthenticatedRequest;
  authReq.tenantId = 'default';
  authReq.userId = 'default';
  authReq.authMethod = 'facade-key';
  next();
}

/**
 * @deprecated Use {@link requireAuth}. Retained as an alias for callers/tests
 * that import `requireApiKey`.
 */
export const requireApiKey = requireAuth;
