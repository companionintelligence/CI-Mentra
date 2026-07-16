// Real jose, except createRemoteJWKSet is replaced with a resolver that returns
// our locally generated Ed25519 public key — so jwtVerify runs for real
// (signature + iss/aud/exp checks) without any network fetch.
jest.mock('jose', () => {
  const actual = jest.requireActual('jose');
  return { __esModule: true, ...actual, createRemoteJWKSet: jest.fn() };
});

const mockConfig = {
  auth: {
    portal: {
      enabled: true,
      issuer: 'https://hub.ci.computer/api/auth',
      jwksUri: 'https://hub.ci.computer/api/auth/jwks',
      audience: ['ci-mentra', 'ci-server'],
    },
  },
};
jest.mock('../../config', () => ({ config: mockConfig }));

import * as jose from 'jose';
import { verifyPortalToken, isPortalAuthEnabled } from '../../auth/portal-token';

let privateKey: jose.KeyLike;
let publicKey: jose.KeyLike;

async function mintToken(overrides: {
  issuer?: string;
  audience?: string;
  subject?: string;
  email?: string;
  expiresIn?: string;
} = {}): Promise<string> {
  return new jose.SignJWT({ email: overrides.email ?? 'liam@companionintelligence.com', name: 'Liam' })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(overrides.issuer ?? mockConfig.auth.portal.issuer)
    .setAudience(overrides.audience ?? 'ci-mentra')
    .setSubject(overrides.subject ?? 'user-abc')
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '5m')
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
  // The JWKS "getter" jose expects: (header, token) => Promise<KeyLike>
  (jose.createRemoteJWKSet as jest.Mock).mockReturnValue(async () => publicKey);
});

beforeEach(() => {
  mockConfig.auth.portal.enabled = true;
});

describe('verifyPortalToken', () => {
  it('reports enabled state from config', () => {
    expect(isPortalAuthEnabled()).toBe(true);
    mockConfig.auth.portal.enabled = false;
    expect(isPortalAuthEnabled()).toBe(false);
  });

  it('returns null when Portal auth is disabled', async () => {
    mockConfig.auth.portal.enabled = false;
    const token = await mintToken();
    expect(await verifyPortalToken(token)).toBeNull();
  });

  it('verifies a valid EdDSA token and maps identity claims', async () => {
    const token = await mintToken({ subject: 'user-abc', email: 'liam@ci.com' });
    const identity = await verifyPortalToken(token);

    expect(identity).not.toBeNull();
    expect(identity!.subject).toBe('user-abc');
    expect(identity!.email).toBe('liam@ci.com');
    expect(identity!.tenantId).toBe('liam@ci.com'); // email preferred as tenant key
    expect(identity!.clientId).toBe('ci-mentra');
  });

  it('rejects a malformed token', async () => {
    expect(await verifyPortalToken('not-a-jwt')).toBeNull();
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await mintToken({ issuer: 'https://evil.example/api/auth' });
    expect(await verifyPortalToken(token)).toBeNull();
  });

  it('rejects a token whose audience is not in the allowlist', async () => {
    const token = await mintToken({ audience: 'some-other-client' });
    expect(await verifyPortalToken(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await mintToken({ expiresIn: '-1m' });
    expect(await verifyPortalToken(token)).toBeNull();
  });
});
