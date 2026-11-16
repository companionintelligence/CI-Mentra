import type { Request, Response } from 'express';

// Controllable config + portal verifier so we exercise middleware branching
// without touching jose or the network.
const mockConfig = {
  auth: { portal: { enabled: false }, owners: [] as string[] },
  facade: { apiKey: '' },
};

jest.mock('../../config', () => ({ config: mockConfig }));
jest.mock('../../auth/portal-token', () => ({
  isPortalAuthEnabled: jest.fn(() => mockConfig.auth.portal.enabled),
  verifyPortalToken: jest.fn(),
}));

import { requireAuth, AuthenticatedRequest } from '../../middleware/auth.ts';
import { verifyPortalToken } from '../../auth/portal-token.ts';
import { createSession, clearAllSessions } from '../../auth/sessions.ts';

const mockedVerify = verifyPortalToken as jest.MockedFunction<typeof verifyPortalToken>;

function makeReqRes(authHeader?: string, signedCookies?: Record<string, string>) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    signedCookies: signedCookies || {},
    ip: '127.0.0.1',
  } as unknown as Request;
  const state = { statusCode: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  } as unknown as Response;
  const next = jest.fn();
  return { req, res, next, state };
}

beforeEach(() => {
  mockConfig.auth.portal.enabled = false;
  mockConfig.auth.owners = [];
  mockConfig.facade.apiKey = '';
  mockedVerify.mockReset();
  clearAllSessions();
});

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const { req, res, next, state } = makeReqRes();
    await requireAuth(req, res, next);
    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid OIDC login session cookie (no bearer needed)', async () => {
    const session = createSession(
      { sub: 'user-9', email: 'liam@ci.computer', name: 'Liam' },
      { access_token: 'a', id_token: 'i' },
      60_000
    );
    const { req, res, next } = makeReqRes(undefined, { mentra_session: session.id });
    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    const authReq = req as AuthenticatedRequest;
    expect(authReq.authMethod).toBe('oidc-session');
    expect(authReq.tenantId).toBe('liam@ci.computer');
    expect(authReq.userId).toBe('user-9');
  });

  describe('Portal disabled (legacy facade key)', () => {
    it('allows any bearer when no facade key is configured', async () => {
      const { req, res, next } = makeReqRes('Bearer anything');
      await requireAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect((req as AuthenticatedRequest).tenantId).toBe('default');
      expect((req as AuthenticatedRequest).authMethod).toBe('facade-key');
    });

    it('rejects a wrong key and accepts the correct key', async () => {
      mockConfig.facade.apiKey = 'secret-key';

      const wrong = makeReqRes('Bearer nope');
      await requireAuth(wrong.req, wrong.res, wrong.next);
      expect(wrong.state.statusCode).toBe(401);
      expect(wrong.next).not.toHaveBeenCalled();

      const right = makeReqRes('Bearer secret-key');
      await requireAuth(right.req, right.res, right.next);
      expect(right.next).toHaveBeenCalled();
    });
  });

  describe('Portal enabled (OIDC)', () => {
    beforeEach(() => {
      mockConfig.auth.portal.enabled = true;
    });

    it('accepts a valid Portal token and attaches identity', async () => {
      mockedVerify.mockResolvedValue({
        subject: 'user-123',
        email: 'liam@companionintelligence.com',
        tenantId: 'liam@companionintelligence.com',
        clientId: 'ci-mentra',
        claims: {},
      });

      const { req, res, next } = makeReqRes('Bearer valid.portal.jwt');
      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      const authReq = req as AuthenticatedRequest;
      expect(authReq.authMethod).toBe('portal-oidc');
      expect(authReq.tenantId).toBe('liam@companionintelligence.com');
      expect(authReq.userId).toBe('user-123');
      expect(authReq.email).toBe('liam@companionintelligence.com');
    });

    it('rejects an invalid token when no static key is configured', async () => {
      mockedVerify.mockResolvedValue(null);
      const { req, res, next, state } = makeReqRes('Bearer bad');
      await requireAuth(req, res, next);
      expect(state.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('lets a service client through with the static facade key even when OIDC is on', async () => {
      mockedVerify.mockResolvedValue(null);
      mockConfig.facade.apiKey = 'service-key';

      const { req, res, next } = makeReqRes('Bearer service-key');
      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as AuthenticatedRequest).authMethod).toBe('facade-key');
      expect((req as AuthenticatedRequest).tenantId).toBe('service');
    });

    it('does not fall back to allow-all when OIDC is on and no static key is set', async () => {
      mockedVerify.mockResolvedValue(null);
      mockConfig.facade.apiKey = '';

      const { req, res, next, state } = makeReqRes('Bearer whatever');
      await requireAuth(req, res, next);

      expect(state.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  /**
   * The facade runs the appliance's models, so it serves the same owners as the
   * companion API. A Portal sign-in or token only proves the caller has a Portal
   * account, not that this appliance is theirs.
   */
  describe('owner allowlist (MENTRA_ALLOWED_USERS)', () => {
    const owner = { sub: 'user-owner', email: 'owner@example.com', name: 'Owner' };
    const stranger = { sub: 'user-stranger', email: 'stranger@example.com', name: 'Someone Else' };

    function sessionCookieFor(user: { sub: string; email?: string; name?: string }) {
      const session = createSession(user, { access_token: 'a', id_token: 'i' }, 60_000);
      return { mentra_session: session.id };
    }

    function portalIdentityFor(user: { sub: string; email?: string }) {
      return { subject: user.sub, email: user.email, tenantId: user.email || user.sub, clientId: 'ci-mentra', claims: {} };
    }

    beforeEach(() => {
      mockConfig.auth.owners = ['owner@example.com'];
    });

    it("accepts the owner's sign-in session", async () => {
      const { req, res, next } = makeReqRes(undefined, sessionCookieFor(owner));
      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as AuthenticatedRequest).authMethod).toBe('oidc-session');
      expect((req as AuthenticatedRequest).userId).toBe('user-owner');
    });

    it('matches the owner on sub when the session has no email', async () => {
      mockConfig.auth.owners = ['user-owner'];

      const { req, res, next } = makeReqRes(undefined, sessionCookieFor({ sub: 'user-owner', name: 'Owner' }));
      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('refuses the sign-in session of a Portal user who is not an owner', async () => {
      const { req, res, next, state } = makeReqRes(undefined, sessionCookieFor(stranger));
      await requireAuth(req, res, next);

      expect(state.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("still accepts the static facade key alongside a non-owner's session", async () => {
      mockConfig.facade.apiKey = 'service-key';

      const { req, res, next } = makeReqRes('Bearer service-key', sessionCookieFor(stranger));
      await requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as AuthenticatedRequest).authMethod).toBe('facade-key');
    });

    describe('with Portal bearer tokens on', () => {
      beforeEach(() => {
        mockConfig.auth.portal.enabled = true;
      });

      it("accepts the owner's Portal token", async () => {
        mockedVerify.mockResolvedValue(portalIdentityFor(owner));

        const { req, res, next } = makeReqRes('Bearer owner.portal.jwt');
        await requireAuth(req, res, next);

        expect(next).toHaveBeenCalled();
        expect((req as AuthenticatedRequest).authMethod).toBe('portal-oidc');
      });

      it('refuses the Portal token of a user who is not an owner', async () => {
        mockedVerify.mockResolvedValue(portalIdentityFor(stranger));

        const { req, res, next, state } = makeReqRes('Bearer stranger.portal.jwt');
        await requireAuth(req, res, next);

        expect(state.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
      });
    });

    it('serves every Portal user when the list is empty (the default)', async () => {
      mockConfig.auth.owners = [];
      mockConfig.auth.portal.enabled = true;
      mockedVerify.mockResolvedValue(portalIdentityFor(stranger));

      const session = makeReqRes(undefined, sessionCookieFor(stranger));
      await requireAuth(session.req, session.res, session.next);
      expect(session.next).toHaveBeenCalled();

      const bearer = makeReqRes('Bearer stranger.portal.jwt');
      await requireAuth(bearer.req, bearer.res, bearer.next);
      expect(bearer.next).toHaveBeenCalled();
    });
  });
});
