import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { isPortalAuthEnabled, verifyPortalToken } from '../auth/portal-token';
import pino from 'pino';

const logger = pino({ name: 'auth' });

export type AuthMethod = 'portal-oidc' | 'facade-key';

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
 * Accepts a Bearer token that is either:
 *  1. A CI-Portal OIDC JWT (validated via JWKS) — when `PORTAL_OIDC_ENABLED`.
 *  2. The static `FACADE_API_KEY` — for machine/dev clients (and always when
 *     Portal auth is disabled, matching the original behavior).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    unauthorized(res, 'Missing or invalid Authorization header. Expected: Bearer <token>');
    return;
  }

  if (isPortalAuthEnabled()) {
    const identity = await verifyPortalToken(token);
    if (identity) {
      const authReq = req as AuthenticatedRequest;
      authReq.tenantId = identity.tenantId;
      authReq.userId = identity.subject || identity.tenantId;
      authReq.email = identity.email;
      authReq.authMethod = 'portal-oidc';
      next();
      return;
    }

    // Not a valid Portal token — allow an explicitly configured static key
    // through (service clients), otherwise reject. Never fall back to
    // allow-all while OIDC is the intended gate.
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
