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
    expect(config.auth.portal.issuer).toBe('https://hub.ci.computer/api/auth');
    expect(config.auth.portal.audience).toEqual(['ci-mentra', 'ci-server', 'ci-hub']);
    expect(config.hub.appSlug).toBe('hermes-agent');
    expect(config.hub.url).toBe('http://ci-os-hub:3000');
  });

  it('enables Portal OIDC when PORTAL_OIDC_ENABLED is truthy', async () => {
    process.env.PORTAL_OIDC_ENABLED = 'true';
    const { config } = await import('../config');
    expect(config.auth.portal.enabled).toBe(true);
  });
});
