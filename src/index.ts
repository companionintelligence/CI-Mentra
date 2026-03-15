import 'dotenv/config';
import express from 'express';
import { config } from './config';
import { facadeRouter } from './facade';
import { MentraBridge } from './bridge/mentra-bridge';
import pino from 'pino';

const logger = pino({ name: 'main' });

async function main(): Promise<void> {
  // Start the OpenAI-compatible façade server
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // CORS for webview origins
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // OpenAI-compatible API routes
  app.use('/v1', facadeRouter);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mentra-bridge', version: '1.0.0' });
  });

  const facadeServer = app.listen(config.facade.port, () => {
    logger.info({ port: config.facade.port }, 'OpenAI-compatible facade listening');
  });

  // Start the Mentra Bridge (MentraOS AppServer)
  // Only start if API key is configured
  if (config.mentra.apiKey) {
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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
