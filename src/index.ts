import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import { fileURLToPath } from 'node:url';
import { applyHubInferenceBootstrap } from './hub/inference-bootstrap.ts';
import { applyFacadeCors, applySetupCors, parseSetupOrigins } from './http/cors.ts';

const logger = pino({ name: 'main' });

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
  const { config } = await import('./config.ts');
  const { facadeRouter } = await import('./facade/index.ts');
  const { authRouter } = await import('./auth/routes.ts');
  const { companionRouter } = await import('./api/companion.ts');
  const { MentraBridge } = await import('./bridge/mentra-bridge.ts');
  const { createLocalBluetoothRuntimeInfo } = await import('./bluetooth/local-sdk.ts');
  const { ensureSchema } = await import('./store/postgres.ts');

  // Create tables on a bare Postgres (Hub installs have no initdb mount). Fail-open.
  await ensureSchema();

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
  applySetupCors(app, parseSetupOrigins(process.env.MENTRA_SETUP_ORIGINS));

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
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { extensions: ['html'] }));

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

// Entry point only: the testable pieces live in ./http/cors.ts, so nothing
// imports this module and it can boot unconditionally (Node ESM and Deno alike).
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
