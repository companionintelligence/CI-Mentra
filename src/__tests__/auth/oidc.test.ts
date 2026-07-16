import crypto from 'node:crypto';
import {
  base64url,
  pkcePair,
  randomToken,
  authorizationUrl,
  toUserClaims,
  endSessionUrl,
  type Discovery,
  type OidcConfig,
} from '../../auth/oidc';

const DOC: Discovery = {
  issuer: 'https://hub.companionintelligence.com',
  authorization_endpoint: 'https://hub.companionintelligence.com/api/auth/oauth2/authorize',
  token_endpoint: 'https://hub.companionintelligence.com/api/auth/oauth2/token',
  userinfo_endpoint: 'https://hub.companionintelligence.com/api/auth/oauth2/userinfo',
  jwks_uri: 'https://hub.companionintelligence.com/api/auth/jwks',
  end_session_endpoint: 'https://hub.companionintelligence.com/api/auth/oauth2/endsession',
};

const CFG: OidcConfig = {
  issuer: 'https://hub.companionintelligence.com/api/auth',
  clientId: 'ci-mentra',
  scopes: 'openid profile email offline_access',
};

describe('pkce + tokens', () => {
  it('produces a valid S256 challenge for the verifier', () => {
    const { verifier, challenge } = pkcePair();
    const expected = base64url(crypto.createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
    // base64url: no +/=/ characters
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates distinct high-entropy tokens', () => {
    expect(randomToken(24)).not.toBe(randomToken(24));
  });
});

describe('authorizationUrl', () => {
  it('builds a spec-compliant Authorization Code + PKCE URL', () => {
    const url = new URL(
      authorizationUrl(DOC, CFG, {
        redirectUri: 'http://localhost:8080/api/auth/callback',
        state: 'st-1',
        nonce: 'no-1',
        codeChallenge: 'cc-1',
      })
    );

    expect(url.origin + url.pathname).toBe(DOC.authorization_endpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('ci-mentra');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8080/api/auth/callback');
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('nonce')).toBe('no-1');
    expect(url.searchParams.get('code_challenge')).toBe('cc-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});

describe('toUserClaims', () => {
  it('maps name/email/picture and falls back to given+family name', () => {
    expect(toUserClaims({ sub: 'u1', name: 'Liam B', email: 'l@ci.com', picture: 'p' })).toEqual({
      sub: 'u1',
      name: 'Liam B',
      email: 'l@ci.com',
      picture: 'p',
    });
    expect(toUserClaims({ sub: 'u2', given_name: 'Liam', family_name: 'Broza' }).name).toBe('Liam Broza');
    expect(toUserClaims({ sub: 'u3', preferred_username: 'liam' }).name).toBe('liam');
  });
});

describe('endSessionUrl', () => {
  it('builds an RP-initiated logout URL with hints', () => {
    const url = new URL(
      endSessionUrl(DOC, { idTokenHint: 'idtok', postLogoutRedirectUri: 'http://localhost:8080/' })!
    );
    expect(url.origin + url.pathname).toBe(DOC.end_session_endpoint);
    expect(url.searchParams.get('id_token_hint')).toBe('idtok');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:8080/');
  });

  it('returns undefined when the provider has no end_session_endpoint', () => {
    const { end_session_endpoint, ...doc } = DOC;
    void end_session_endpoint;
    expect(endSessionUrl(doc as Discovery, { idTokenHint: 'x' })).toBeUndefined();
  });
});
