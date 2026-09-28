import express from 'express';
import request from 'supertest';
import { applySetupCors, parseSetupOrigins, DEFAULT_SETUP_ORIGINS } from '../http/cors.ts';

function makeApp(origins = DEFAULT_SETUP_ORIGINS) {
  const app = express();
  applySetupCors(app, origins);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/companion/status', (_req, res) => {
    res.json({ authenticated: false });
  });
  return app;
}

describe('parseSetupOrigins', () => {
  it('defaults to the hosted setup site', () => {
    expect(parseSetupOrigins(undefined)).toEqual(['https://mentra.ci.computer']);
  });

  it('parses a comma list, trims slashes, and drops junk', () => {
    expect(parseSetupOrigins(' https://a.example/, http://localhost:5173 ,*, https://b.example/path,')).toEqual([
      'https://a.example',
      'http://localhost:5173',
    ]);
  });

  it('an empty value disables the probe entirely', () => {
    expect(parseSetupOrigins('')).toEqual([]);
  });
});

describe('applySetupCors', () => {
  it('echoes an allowlisted origin on /health', async () => {
    const res = await request(makeApp()).get('/health').set('Origin', 'https://mentra.ci.computer');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://mentra.ci.computer');
    expect(res.headers.vary).toContain('Origin');
  });

  it('sends nothing for other origins', async () => {
    const res = await request(makeApp()).get('/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers the private-network preflight for allowlisted origins', async () => {
    const res = await request(makeApp())
      .options('/health')
      .set('Origin', 'https://mentra.ci.computer')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('never opens the cookie-authenticated /api surface', async () => {
    const res = await request(makeApp()).get('/api/companion/status').set('Origin', 'https://mentra.ci.computer');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
