import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const mockConfig = {
  auth: {
    oidc: {
      enabled: false,
      issuer: 'https://hub.companionintelligence.com/api/auth',
      clientId: 'ci-mentra',
      clientSecret: '',
      scopes: 'openid profile email offline_access',
      redirectUri: '',
      providerName: 'Companion Intelligence',
      postLogoutRedirectUri: '',
      sessionSecret: '',
      sessionTtlMs: 60_000,
    },
  },
};
jest.mock('../../config', () => ({ config: mockConfig }));

import { authRouter, encodeTx, decodeTx } from '../../auth/routes.ts';

function makeApp() {
  const app = express();
  app.use(cookieParser('test-secret'));
  app.use('/api/auth', authRouter);
  return app;
}

beforeEach(() => {
  mockConfig.auth.oidc.enabled = false;
});

describe('tx cookie encode/decode', () => {
  it('round-trips a login transaction', () => {
    const tx = { state: 's', nonce: 'n', verifier: 'v', redirectUri: 'http://x/cb', returnTo: '/' };
    expect(decodeTx(encodeTx(tx))).toEqual(tx);
  });

  it('returns null for a malformed tx', () => {
    expect(decodeTx('!!!not-base64-json')).toBeNull();
    expect(decodeTx(undefined)).toBeNull();
  });
});

describe('GET /api/auth/config', () => {
  it('reports disabled by default', async () => {
    const res = await request(makeApp()).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.loginUrl).toBe('/api/auth/login');
    expect(res.body.clientId).toBe('ci-mentra');
  });

  it('reports enabled when configured', async () => {
    mockConfig.auth.oidc.enabled = true;
    const res = await request(makeApp()).get('/api/auth/config');
    expect(res.body.enabled).toBe(true);
    expect(res.body.providerName).toBe('Companion Intelligence');
  });
});

describe('GET /api/auth/login (disabled)', () => {
  it('returns 503 when OIDC login is disabled', async () => {
    const res = await request(makeApp()).get('/api/auth/login');
    expect(res.status).toBe(503);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 with no session cookie', async () => {
    const res = await request(makeApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.authenticated).toBe(false);
  });
});
