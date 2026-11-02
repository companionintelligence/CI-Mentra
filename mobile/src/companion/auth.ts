// Sign-in with CI-Portal, Authorization Code with PKCE, the flow the other Companion apps use.
// The app holds the tokens in the device keystore and presents the access token to the appliance.
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { PORTAL_CLIENT_ID, PORTAL_DISCOVERY_ISSUER, PORTAL_SCOPES, REDIRECT_PATH, REDIRECT_SCHEME } from './config';
import { needsRefresh, parseStoredTokens, tokensFromResponse, type StoredTokens } from './tokens';

// Completes a browser session that was opened in a tab (on web). Harmless on device.
WebBrowser.maybeCompleteAuthSession();

const KEY_ACCESS = 'companion.portal.accessToken';
const KEY_REFRESH = 'companion.portal.refreshToken';
const KEY_EXPIRES = 'companion.portal.expiresAt';

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

export function redirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: REDIRECT_SCHEME, path: REDIRECT_PATH });
}

let discovery: Promise<AuthSession.DiscoveryDocument> | null = null;

function portalDiscovery(): Promise<AuthSession.DiscoveryDocument> {
  if (!discovery) {
    discovery = AuthSession.fetchDiscoveryAsync(PORTAL_DISCOVERY_ISSUER).catch((error: unknown) => {
      discovery = null;
      throw error;
    });
  }
  return discovery;
}

async function loadTokens(): Promise<StoredTokens | null> {
  const [accessToken, refreshToken, expiresAt] = await Promise.all([
    SecureStore.getItemAsync(KEY_ACCESS, STORE_OPTIONS),
    SecureStore.getItemAsync(KEY_REFRESH, STORE_OPTIONS),
    SecureStore.getItemAsync(KEY_EXPIRES, STORE_OPTIONS),
  ]);
  return parseStoredTokens({ accessToken, refreshToken, expiresAt });
}

async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_ACCESS, tokens.accessToken, STORE_OPTIONS),
    SecureStore.setItemAsync(KEY_REFRESH, tokens.refreshToken ?? '', STORE_OPTIONS),
    SecureStore.setItemAsync(KEY_EXPIRES, String(tokens.expiresAt), STORE_OPTIONS),
  ]);
}

/** Forgets the tokens on this phone. Glasses data already queued stays queued. */
export async function signOut(): Promise<void> {
  await Promise.all(
    [KEY_ACCESS, KEY_REFRESH, KEY_EXPIRES].map((key) => SecureStore.deleteItemAsync(key, STORE_OPTIONS)),
  );
}

/** Opens CI-Portal in the browser, exchanges the code and keeps the tokens. */
export async function signIn(): Promise<StoredTokens> {
  const document = await portalDiscovery();
  const redirect = redirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: PORTAL_CLIENT_ID,
    redirectUri: redirect,
    scopes: PORTAL_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });

  const result = await request.promptAsync(document);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new SignInError('Sign-in was cancelled.');
  }
  if (result.type !== 'success') {
    throw new SignInError('Sign-in did not finish. Try again.');
  }
  const code = result.params.code;
  const codeVerifier = request.codeVerifier;
  if (!code || !codeVerifier) {
    throw new SignInError('CI-Portal did not return a sign-in code.');
  }

  const response = await AuthSession.exchangeCodeAsync(
    { clientId: PORTAL_CLIENT_ID, code, redirectUri: redirect, extraParams: { code_verifier: codeVerifier } },
    document,
  );
  const tokens = tokensFromResponse(response, Date.now());
  await saveTokens(tokens);
  return tokens;
}

/** One renewal at a time, shared by every caller that finds the token close to expiry. */
let renewal: Promise<StoredTokens | null> | null = null;

async function renew(stored: StoredTokens): Promise<StoredTokens | null> {
  if (!stored.refreshToken) {
    return null;
  }
  if (!renewal) {
    const refreshToken = stored.refreshToken;
    renewal = (async () => {
      try {
        const document = await portalDiscovery();
        const response = await AuthSession.refreshAsync(
          { clientId: PORTAL_CLIENT_ID, refreshToken, scopes: PORTAL_SCOPES },
          document,
        );
        const tokens = tokensFromResponse(
          { ...response, refreshToken: response.refreshToken || refreshToken },
          Date.now(),
        );
        await saveTokens(tokens);
        return tokens;
      } catch {
        return null;
      } finally {
        renewal = null;
      }
    })();
  }
  return renewal;
}

/**
 * The access token to present now, renewed first when it is close to expiry.
 * Null when the phone is signed out, or when the session can no longer be renewed.
 */
export async function currentAccessToken(): Promise<string | null> {
  const stored = await loadTokens();
  if (!stored) {
    return null;
  }
  const now = Date.now();
  if (!needsRefresh(stored, now)) {
    return stored.accessToken;
  }
  const renewed = await renew(stored);
  if (renewed) {
    return renewed.accessToken;
  }
  if (stored.expiresAt > now) {
    return stored.accessToken;
  }
  await signOut();
  return null;
}
