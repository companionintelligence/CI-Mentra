import type { Request, Response } from 'express';

// Controllable config + portal verifier so we exercise middleware branching
// without touching jose or the network.
const mockConfig = {
  auth: { portal: { enabled: false } },
  facade: { apiKey: '' },
};

jest.mock('../../config', () => ({ config: mockConfig }));
jest.mock('../../auth/portal-token', () => ({
  isPortalAuthEnabled: jest.fn(() => mockConfig.auth.portal.enabled),
  verifyPortalToken: jest.fn(),
}));

import { requireAuth, AuthenticatedRequest } from '../../middleware/auth';
import { verifyPortalToken } from '../../auth/portal-token';

const mockedVerify = verifyPortalToken as jest.MockedFunction<typeof verifyPortalToken>;

function makeReqRes(authHeader?: string) {
  const req = { headers: authHeader ? { authorization: authHeader } : {}, ip: '127.0.0.1' } as unknown as Request;
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
  mockConfig.facade.apiKey = '';
  mockedVerify.mockReset();
});

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const { req, res, next, state } = makeReqRes();
    await requireAuth(req, res, next);
    expect(state.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
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
});
