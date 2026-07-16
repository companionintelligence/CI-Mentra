import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import { applyHubInferenceBootstrap } from './hub/inference-bootstrap';

const logger = pino({ name: 'main' });

/**
 * Wildcard CORS, scoped to the OpenAI-compatible facade (`/v1`) ONLY.
 *
 * `/v1` is a bearer-token API for webviews: a cross-origin page can only call
 * it if it already holds a token, and `Access-Control-Allow-Origin: *` forbids
 * credentialed (cookie-bearing) requests by definition. Wildcard is correct there.
 *
 * `/api/*` — the companion BFF and the auth routes — is the opposite: it is
 * same-origin and authenticated by the session COOKIE. Sending ACAO `*` there
 * let any website the wearer happens to visit `fetch()`
 * `http://localhost:<port>/api/companion/profile` and *read the response body*,
 * because the wildcard is what grants the read. With MENTRA_DEV_ALLOW_ANONYMOUS
 * on, that response is the wearer's entire private memory, no credentials
 * needed. Omitting the header makes the browser withhold the response.
 *
 * Exported (rather than inlined into `main`) so the scoping is testable without
 * booting a server.
 */
export function applyFacadeCors(app: express.Application): void {
  app.use('/v1', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

async function main(): Promise<void> {
  // Adopt CI-Hub inference credentials (Ollama + hermes/openclaw backend)
  // BEFORE `config` is evaluated, so discovered endpoints flow into config.
  // Fail-open: a Hub that is unreachable never blocks startup.
  const hubBootstrap = await applyHubInferenceBootstrap();
  if (hubBootstrap.attempted) {
    logger.info(hubBootstrap, 'CI-Hub inference bootstrap result');
  }

  // Deferred imports: these modules read `config`, which must resolve AFTER the
  // Hub bootstrap has populated the environment.
  const { config } = await import('./config');
  const { facadeRouter } = await import('./facade');
  const { authRouter } = await import('./auth/routes');
  const { companionRouter } = await import('./api/companion');
  const { MentraBridge } = await import('./bridge/mentra-bridge');
  const { createLocalBluetoothRuntimeInfo } = await import('./bluetooth/local-sdk');

  const localBluetoothRuntimeInfo =
    config.runtime.mode === 'bluetooth-local'
      ? createLocalBluetoothRuntimeInfo(
          config.runtime.bluetooth.sdkVersion,
          config.runtime.bluetooth.target,
          config.runtime.bluetooth.packagePath
        )
      : null;

  // Start the OpenAI-compatible façade server
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Signs the OIDC tx + session cookies. A configured secret keeps sessions
  // valid across restarts; otherwise a random per-boot secret is used.
  const cookieSecret = config.auth.oidc.sessionSecret || crypto.randomBytes(32).toString('hex');
  app.use(cookieParser(cookieSecret));

  // CORS for webview origins — facade only; never on the cookie-authenticated
  // /api surface. See `applyFacadeCors`.
  applyFacadeCors(app);

  // CI-Portal OIDC login (Authorization Code + PKCE): /api/auth/{config,login,callback,logout,me}
  app.use('/api/auth', authRouter);

  // Companion BFF for the ring/phone UI: ask, memory search/remember, profile, history
  app.use('/api/companion', companionRouter);

  // OpenAI-compatible API routes
  app.use('/v1', facadeRouter);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'mentra-bridge',
      version: '1.0.0',
      runtimeMode: config.runtime.mode,
      auth: {
        mode: config.auth.portal.enabled ? 'portal-oidc' : 'facade-key',
        portalIssuer: config.auth.portal.enabled ? config.auth.portal.issuer : undefined,
        oidcLogin: config.auth.oidc.enabled
          ? { enabled: true, provider: config.auth.oidc.providerName, clientId: config.auth.oidc.clientId, loginUrl: '/api/auth/login' }
          : { enabled: false },
      },
      inference: {
        defaultProvider: config.providers.default,
        ollamaBaseUrl: config.providers.ollama.baseUrl,
        hermesBackendConfigured: Boolean(config.providers.hermes.baseUrl),
        hubBootstrap: {
          attempted: hubBootstrap.attempted,
          applied: hubBootstrap.applied,
          slug: hubBootstrap.slug,
        },
      },
      memory: {
        enabled: config.memory.enabled && Boolean(config.memory.apiKey),
        baseUrl: config.memory.baseUrl,
        platform: config.memory.platform,
      },
      companionUi: { path: '/', devAnonymous: config.dev.allowAnonymous },
      bluetooth: localBluetoothRuntimeInfo,
    });
  });

  // Companion UI (ring + phone) — static, mounted last so it never shadows an API route.
  // `public/` is not compiled, so it sits next to dist/ at the repo root.
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  const facadeServer = app.listen(config.facade.port, () => {
    logger.info(
      { port: config.facade.port, authMode: config.auth.portal.enabled ? 'portal-oidc' : 'facade-key' },
      'OpenAI-compatible facade listening'
    );
  });

  // Start Mentra cloud bridge unless runtime is configured for local Bluetooth SDK usage
  if (localBluetoothRuntimeInfo) {
    logger.info(localBluetoothRuntimeInfo, 'Bluetooth-local runtime selected');
    logger.info(
      { flow: localBluetoothRuntimeInfo.ftue.firstTimeFlow },
      'FTUE flow loaded for selected headset target'
    );
  } else if (config.mentra.apiKey) {
    const bridge = new MentraBridge();
    await bridge.start();
    logger.info({ port: config.mentra.port }, 'Mentra Bridge (MentraOS AppServer) started');
  } else {
    logger.warn('MENTRA_API_KEY not set, skipping Mentra Bridge startup');
  }

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down');
    facadeServer.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down');
    facadeServer.close();
    process.exit(0);
  });
}

// Only boot when executed as a program (`node dist/index.js` / `ts-node src/index.ts`).
// Guarded so tests can import `applyFacadeCors` without starting servers.
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
