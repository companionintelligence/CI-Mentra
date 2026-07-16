import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { getSession, SESSION_COOKIE } from '../auth/sessions';
import type { AuthMethod } from './auth';
import pino from 'pino';

const logger = pino({ name: 'companion-auth' });

/**
 * The companion UI is a first-party browser client, so unlike the OpenAI facade
 * it authenticates primarily by the OIDC login *session cookie* rather than a
 * presented bearer. `dev-anonymous` exists only for local development and is
 * never reachable unless MENTRA_DEV_ALLOW_ANONYMOUS is explicitly set.
 */
export type CompanionAuthMethod = AuthMethod | 'dev-anonymous';

export interface CompanionUser {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

export interface CompanionIdentity {
  userId: string;
  tenantId: string;
  user: CompanionUser;
  authMethod: CompanionAuthMethod;
}

export interface CompanionRequest extends Request {
  tenantId: string;
  userId: string;
  email?: string;
  authMethod?: CompanionAuthMethod;
  companionUser?: CompanionUser;
}

function extractBearer(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

/** Warn-once latch for the empty-allowlist case. See `isOwner`. */
let warnedOpenOwnership = false;

/**
 * Test/maintenance helper: re-arm the empty-allowlist warning.
 * Only exists because the latch below is module-global by design.
 */
export function resetOwnerWarning(): void {
  warnedOpenOwnership = false;
}

/**
 * Authorization, as distinct from authentication.
 *
 * A resolved OIDC session only proves CI-Portal vouched for this person. This
 * is a personal device holding one wearer's private memory, so it must serve
 * its OWNER — not "anyone with a valid Portal account". `config.auth.owners`
 * (MENTRA_ALLOWED_USERS) is that owner list, matched case-insensitively on
 * email or sub.
 *
 * An EMPTY list allows, because every existing single-user deployment has one
 * and silently locking them all out is worse than the exposure. But it is not
 * silent: we warn once per process so the operator learns the box is open to
 * any Portal user. The warn is latched rather than per-request — a line on
 * every call is noise that gets filtered, not a signal.
 */
function isOwner(user: CompanionUser): boolean {
  const owners = config.auth?.owners ?? [];

  if (owners.length === 0) {
    if (!warnedOpenOwnership) {
      warnedOpenOwnership = true;
      logger.warn(
        { hint: 'Set MENTRA_ALLOWED_USERS to a comma-separated list of owner emails.' },
        'MENTRA_ALLOWED_USERS is not set: ANY user who can sign in to CI-Portal has full read/write access to this wearer\'s private memory.'
      );
    }
    return true;
  }

  const candidates = [user.email, user.sub]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));

  return candidates.some((value) => owners.includes(value));
}

/**
 * Resolve who is calling, without rejecting. Returned separately from the
 * middleware because `GET /status` must report `authenticated: false` with a
 * 200 so the UI can render a login gate instead of an error.
 *
 * Order: OIDC login session → static facade key (service clients) → dev
 * anonymous. Config is read with optional chaining so a partially-stubbed
 * config can never turn a missing field into a thrown 500.
 */
export function resolveCompanionIdentity(req: Request): CompanionIdentity | null {
  // 1. Interactive OIDC login session (signed cookie set by /api/auth/callback).
  //    A session that isn't the appliance owner's is treated as no session at
  //    all: we fall through rather than return early, so a non-owner is never
  //    *worse* off than a caller with no cookie — the facade-key and
  //    dev-anonymous paths below are unchanged by ownership. With neither of
  //    those configured (the normal deployment) this yields null, so /status
  //    reports authenticated:false and the guard 401s.
  const sid = (req.signedCookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const session = getSession(sid);
  if (session) {
    if (isOwner(session.user)) {
      return {
        userId: session.user.sub,
        tenantId: session.user.email || session.user.sub,
        user: session.user,
        authMethod: 'oidc-session',
      };
    }
    // Logged per-attempt on purpose: a signed-in non-owner is an anomaly worth
    // seeing, and the email is what the operator needs to fix the allowlist.
    logger.warn(
      { sub: session.user.sub, email: session.user.email, path: req.path },
      'Denying signed-in CI-Portal user: not in the MENTRA_ALLOWED_USERS owner allowlist'
    );
  }

  // 2. Static facade key — machine/service clients. Only honored when a key is
  //    actually configured; an empty key must never mean "allow any bearer".
  const facadeKey = config.facade?.apiKey;
  const token = extractBearer(req);
  if (facadeKey && token && token === facadeKey) {
    return {
      userId: 'service',
      tenantId: 'service',
      user: { sub: 'service', name: 'Service client' },
      authMethod: 'facade-key',
    };
  }

  // 3. Local development without a login.
  if (config.dev?.allowAnonymous) {
    return {
      userId: 'dev',
      tenantId: 'dev',
      user: { sub: 'dev', name: 'Local dev' },
      authMethod: 'dev-anonymous',
    };
  }

  return null;
}

/** Attach the resolved identity to the request, or reject with a 401. */
export async function requireCompanionAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identity = resolveCompanionIdentity(req);
  if (!identity) {
    logger.debug({ ip: req.ip, path: req.path }, 'Unauthenticated companion request');
    res.status(401).json({
      error: {
        message: 'Not signed in. Sign in at /api/auth/login or present a valid API key.',
        type: 'authentication_error',
      },
    });
    return;
  }

  const companionReq = req as CompanionRequest;
  companionReq.userId = identity.userId;
  companionReq.tenantId = identity.tenantId;
  companionReq.email = identity.user.email;
  companionReq.authMethod = identity.authMethod;
  companionReq.companionUser = identity.user;
  next();
}
