import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { config } from '../config.ts';
import pino from 'pino';

const logger = pino({ name: 'portal-oidc' });

/**
 * Identity resolved from a verified CI-Portal (better-auth) OIDC token.
 */
export interface PortalIdentity {
  subject: string;
  email?: string;
  name?: string;
  /** Stable per-user tenant key (email if present, else subject). */
  tenantId: string;
  /** OAuth client the token was minted for (from `azp`/`aud`). */
  clientId?: string;
  claims: JWTPayload;
}

// Cache the remote JWKS across requests; rebuild only if the URI changes.
let cachedJwks: JWTVerifyGetKey | undefined;
let cachedJwksUri: string | undefined;

function getJwks(jwksUri: string): JWTVerifyGetKey {
  if (!cachedJwks || cachedJwksUri !== jwksUri) {
    cachedJwks = createRemoteJWKSet(new URL(jwksUri));
    cachedJwksUri = jwksUri;
  }
  return cachedJwks;
}

export function isPortalAuthEnabled(): boolean {
  return config.auth?.portal?.enabled === true;
}

function extractClientId(payload: JWTPayload): string | undefined {
  if (typeof payload.azp === 'string') return payload.azp;
  if (Array.isArray(payload.aud)) return payload.aud[0];
  if (typeof payload.aud === 'string') return payload.aud;
  return undefined;
}

/**
 * Verify a CI-Portal-issued JWT as a resource server.
 *
 * CI-Portal (better-auth) is the platform identity provider; it signs JWTs with
 * EdDSA (Ed25519) and publishes a JWKS at `<issuer>/jwks`. We validate the
 * signature against that JWKS and check `iss`/`aud`/`exp`, mirroring
 * CI-Server's PortalTokenService. Returns `null` for any invalid token (wrong
 * signer, issuer, audience, or expired) so callers can fall through to other
 * auth schemes.
 */
export async function verifyPortalToken(token: string): Promise<PortalIdentity | null> {
  const portal = config.auth?.portal;
  if (!portal?.enabled || !token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(portal.jwksUri), {
      issuer: portal.issuer,
      audience: portal.audience && portal.audience.length > 0 ? portal.audience : undefined,
    });

    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const name = typeof payload.name === 'string' ? payload.name : undefined;
    const subject = typeof payload.sub === 'string' ? payload.sub : '';

    return {
      subject,
      email,
      name,
      tenantId: email || subject || 'portal',
      clientId: extractClientId(payload),
      claims: payload,
    };
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'Portal token verification failed');
    return null;
  }
}
