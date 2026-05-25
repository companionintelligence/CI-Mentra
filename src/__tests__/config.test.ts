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
});
