/**
 * Where the phone app signs in and where it sends glasses data. CI-Portal is the
 * identity provider the other Companion apps use. The appliance is the CI-Mentra
 * server the user runs or the Hub installs. It holds the agent (through the Hub)
 * and Companion Memory.
 */

/** The Portal issuer's discovery base. Its tokens carry the bare origin as `iss`. */
export const PORTAL_DISCOVERY_ISSUER = 'https://hub.companionintelligence.com/api/auth';

/**
 * This app's registered public PKCE client. CI-Portal must list it in PUBLIC_CLIENTS
 * before sign-in works (see mobile/README.md, "Sign in and Companion memory").
 */
export const PORTAL_CLIENT_ID = 'ci-mentra';

export const PORTAL_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

/**
 * The redirect target. CI-Portal admits `companion://auth/callback` and
 * `companion://oidc/callback` as native redirects. The scheme is registered in
 * app.config.ts.
 */
export const REDIRECT_SCHEME = 'companion';
export const REDIRECT_PATH = 'oidc/callback';

/**
 * Turn what the user typed as the appliance address into an origin
 * (`https://host[:port]`). A bare host gets https. Plain http is allowed only for
 * loopback, which is what a development appliance on the same machine uses.
 * Returns null when the text cannot be used.
 */
export function normalizeApplianceUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.username || url.password || !url.hostname) {
    return null;
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'https:') {
    return url.origin;
  }
  if (url.protocol === 'http:' && loopback) {
    return url.origin;
  }
  return null;
}
