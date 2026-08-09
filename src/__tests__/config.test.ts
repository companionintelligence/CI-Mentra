describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('supports Mentra SDK env aliases and normalizes Mentra cloud URL', async () => {
    process.env.PACKAGE_NAME = 'com.example.alias';
    process.env.MENTRAOS_API_KEY = 'alias-api-key';
    process.env.PORT = '7777';
    process.env.MENTRA_CLOUD_API_URL = 'ci-server.internal:8443/';

    const { config } = await import('../config');

    expect(config.mentra.packageName).toBe('com.example.alias');
    expect(config.mentra.apiKey).toBe('alias-api-key');
    expect(config.mentra.port).toBe(7777);
    expect(config.mentra.cloudApiUrl).toBe('https://ci-server.internal:8443');
  });

  it('prefers primary Mentra env vars over SDK aliases when both are set', async () => {
    process.env.MENTRA_PACKAGE_NAME = 'com.example.primary';
    process.env.PACKAGE_NAME = 'com.example.alias';
    process.env.MENTRA_API_KEY = 'primary-api-key';
    process.env.MENTRAOS_API_KEY = 'alias-api-key';
    process.env.MENTRA_PORT = '7010';
    process.env.PORT = '7777';

    const { config } = await import('../config');

    expect(config.mentra.packageName).toBe('com.example.primary');
    expect(config.mentra.apiKey).toBe('primary-api-key');
    expect(config.mentra.port).toBe(7010);
  });

  it('normalizes provider base URLs and supports OpenAI base URL override', async () => {
    process.env.OLLAMA_BASE_URL = 'ollama.local:11434/';
    process.env.VLLM_BASE_URL = 'vllm.internal:8000/';
    process.env.OPENAI_BASE_URL = 'https://openai-proxy.internal/';

    const { config } = await import('../config');

    expect(config.providers.ollama.baseUrl).toBe('http://ollama.local:11434');
    expect(config.providers.vllm.baseUrl).toBe('http://vllm.internal:8000');
    expect(config.providers.openai.baseUrl).toBe('https://openai-proxy.internal');
  });

  it('standardizes Ollama on the Hub convention (OLLAMA_HOST alias, bearer key, default model)', async () => {
    for (const key of ['OLLAMA_BASE_URL', 'OLLAMA_HOST', 'LLM_API_BASE', 'OLLAMA_API_KEY', 'LLM_API_KEY', 'LLM_DEFAULT_CHAT_MODEL', 'OLLAMA_DEFAULT_MODEL']) {
      delete process.env[key];
    }

    // OLLAMA_HOST (Hub/CI-Server convention) is honored when OLLAMA_BASE_URL is unset.
    process.env.OLLAMA_HOST = 'http://host.docker.internal:11434';
    process.env.LLM_DEFAULT_CHAT_MODEL = 'gemma4:latest';

    const { config } = await import('../config');

    expect(config.providers.ollama.baseUrl).toBe('http://host.docker.internal:11434');
    expect(config.providers.ollama.apiKey).toBe('ollama'); // dummy bearer default
    expect(config.providers.ollama.defaultModel).toBe('gemma4:latest');
  });

  it('strips a trailing /v1 from LLM_API_BASE and hermes backend URLs', async () => {
    for (const key of ['OLLAMA_BASE_URL', 'OLLAMA_HOST', 'LLM_API_BASE', 'HERMES_OPENAI_BASE_URL', 'OPENAI_API_BASE', 'HUB_LLM_BASE_URL']) {
      delete process.env[key];
    }
    process.env.LLM_API_BASE = 'http://host.docker.internal:11434/v1';
    process.env.HERMES_OPENAI_BASE_URL = 'http://hermes-gateway:8642/v1';

    const { config } = await import('../config');

    // Providers append /v1 themselves, so config must not double it.
    expect(config.providers.ollama.baseUrl).toBe('http://host.docker.internal:11434');
    expect(config.providers.hermes.baseUrl).toBe('http://hermes-gateway:8642');
  });

  it('parses Portal OIDC config and defaults hub settings', async () => {
    delete process.env.PORTAL_OIDC_ENABLED;
    process.env.PORTAL_OIDC_AUDIENCE = 'ci-mentra, ci-server ,, ci-hub';

    const { config } = await import('../config');

    expect(config.auth.portal.enabled).toBe(false);
    // iss is the bare origin (no /api/auth suffix) — see live discovery doc.
    expect(config.auth.portal.issuer).toBe('https://hub.companionintelligence.com');
    expect(config.auth.portal.jwksUri).toBe('https://hub.companionintelligence.com/api/auth/jwks');
    expect(config.auth.portal.audience).toEqual(['ci-mentra', 'ci-server', 'ci-hub']);
    expect(config.hub.appSlug).toBe('hermes-agent');
    expect(config.hub.url).toBe('http://ci-os-hub:3000');
  });

  it('enables Portal OIDC when PORTAL_OIDC_ENABLED is truthy', async () => {
    process.env.PORTAL_OIDC_ENABLED = 'true';
    const { config } = await import('../config');
    expect(config.auth.portal.enabled).toBe(true);
  });

  it('defaults the interactive OIDC login (CI-Import-Tools style) config', async () => {
    for (const key of ['MENTRA_OIDC_ENABLED', 'MENTRA_OIDC_ISSUER', 'MENTRA_OIDC_CLIENT_ID', 'MENTRA_OIDC_SCOPES']) {
      delete process.env[key];
    }
    const { config } = await import('../config');

    expect(config.auth.oidc.enabled).toBe(false);
    // Discovery base URL includes /api/auth (discovery appends /.well-known/...).
    expect(config.auth.oidc.issuer).toBe('https://hub.companionintelligence.com/api/auth');
    expect(config.auth.oidc.clientId).toBe('ci-mentra');
    expect(config.auth.oidc.scopes).toBe('openid profile email offline_access');
  });

  it('supports overriding the OIDC login client id (e.g. reuse ci-import-tools)', async () => {
    process.env.MENTRA_OIDC_ENABLED = 'true';
    process.env.MENTRA_OIDC_CLIENT_ID = 'ci-import-tools';
    const { config } = await import('../config');
    expect(config.auth.oidc.enabled).toBe(true);
    expect(config.auth.oidc.clientId).toBe('ci-import-tools');
  });

  describe('owner allowlist (MENTRA_ALLOWED_USERS)', () => {
    it('defaults to an empty list (single-user appliance)', async () => {
      delete process.env.MENTRA_ALLOWED_USERS;
      const { config } = await import('../config');
      expect(config.auth.owners).toEqual([]);
    });

    it('parses a comma-separated list, trimming and lowercasing entries', async () => {
      process.env.MENTRA_ALLOWED_USERS = ' Liam@Example.com , wearer@example.com ';
      const { config } = await import('../config');
      expect(config.auth.owners).toEqual(['liam@example.com', 'wearer@example.com']);
    });

    it('drops empty entries so a stray comma can never mean "allow everyone"', async () => {
      process.env.MENTRA_ALLOWED_USERS = 'liam@example.com,,   ,';
      const { config } = await import('../config');
      expect(config.auth.owners).toEqual(['liam@example.com']);
    });

    it('accepts an OIDC subject as well as an email', async () => {
      process.env.MENTRA_ALLOWED_USERS = 'user_01HXYZ';
      const { config } = await import('../config');
      expect(config.auth.owners).toEqual(['user_01hxyz']);
    });
  });

  describe('Companion Memory path prefix (CI_SERVER_MEMORY_PATH_PREFIX)', () => {
    it('defaults to /api (the gateway/Hub-fronted topology)', async () => {
      delete process.env.CI_SERVER_MEMORY_PATH_PREFIX;
      const { config } = await import('../config');
      expect(config.memory.pathPrefix).toBe('/api');
    });

    it('supports an empty prefix for a direct-to-API topology', async () => {
      process.env.CI_SERVER_MEMORY_PATH_PREFIX = '';
      const { config } = await import('../config');
      expect(config.memory.pathPrefix).toBe('');
    });
  });
});
