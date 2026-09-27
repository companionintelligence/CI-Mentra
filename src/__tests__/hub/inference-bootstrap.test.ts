import { parseDotenv, applyHubEnv, applyHubInferenceBootstrap, resolveHubUrl } from '../../hub/inference-bootstrap';

const MANAGED_KEYS = [
  'OLLAMA_HOST',
  'HERMES_OPENAI_BASE_URL',
  'HERMES_OPENAI_API_KEY',
  'HERMES_DEFAULT_MODEL',
  'LLM_DEFAULT_CHAT_MODEL',
  'HUB_LLM_BASE_URL',
  'HUB_LLM_API_KEY',
  'HUB_LLM_MODEL',
];

function clearManaged() {
  for (const key of [...MANAGED_KEYS, 'HUB_INFERENCE_BOOTSTRAP', 'HUB_APP_SLUG', 'CI_HUB_URL', 'HUB_URL', 'LLM_API_BASE', 'LLM_API_KEY', 'OPENAI_API_BASE', 'OPENAI_API_KEY', 'DEFAULT_MODEL']) {
    delete process.env[key];
  }
}

beforeEach(clearManaged);
afterAll(clearManaged);

describe('parseDotenv', () => {
  it('parses key=value pairs, ignoring comments and blanks, stripping quotes', () => {
    const parsed = parseDotenv(
      [
        '# comment',
        '',
        'HERMES_OPENAI_BASE_URL=http://host.docker.internal:11434/v1',
        'HERMES_OPENAI_API_KEY="ollama"',
        "HERMES_DEFAULT_MODEL='gemma4:latest'",
        'export OLLAMA_HOST=http://host.docker.internal:11434',
        'MALFORMED',
      ].join('\n')
    );

    expect(parsed.HERMES_OPENAI_BASE_URL).toBe('http://host.docker.internal:11434/v1');
    expect(parsed.HERMES_OPENAI_API_KEY).toBe('ollama');
    expect(parsed.HERMES_DEFAULT_MODEL).toBe('gemma4:latest');
    expect(parsed.OLLAMA_HOST).toBe('http://host.docker.internal:11434');
    expect(parsed.MALFORMED).toBeUndefined();
  });
});

describe('applyHubEnv', () => {
  it('maps the hermes-agent slug env into canonical vars', () => {
    const applied = applyHubEnv({
      OLLAMA_HOST: 'http://host.docker.internal:11434',
      HERMES_OPENAI_BASE_URL: 'http://host.docker.internal:11434/v1',
      HERMES_OPENAI_API_KEY: 'ollama',
      HERMES_DEFAULT_MODEL: 'gemma4:latest',
    });

    expect(process.env.OLLAMA_HOST).toBe('http://host.docker.internal:11434');
    expect(process.env.HERMES_OPENAI_BASE_URL).toBe('http://host.docker.internal:11434/v1');
    expect(process.env.HERMES_OPENAI_API_KEY).toBe('ollama');
    expect(process.env.HERMES_DEFAULT_MODEL).toBe('gemma4:latest');
    expect(process.env.HUB_LLM_MODEL).toBe('gemma4:latest');
    expect(applied).toEqual(expect.arrayContaining(['OLLAMA_HOST', 'HERMES_OPENAI_BASE_URL']));
  });

  it('derives the backend base URL from OLLAMA_HOST for the openclaw slug', () => {
    applyHubEnv({
      OLLAMA_HOST: 'http://ci-hub-ollama:11434',
      OPENAI_API_BASE: 'http://ci-hub-ollama:11434/v1',
      OPENAI_API_KEY: 'ollama',
      DEFAULT_MODEL: 'qwen3.6:35b',
    });

    expect(process.env.HERMES_OPENAI_BASE_URL).toBe('http://ci-hub-ollama:11434/v1');
    expect(process.env.HERMES_DEFAULT_MODEL).toBe('qwen3.6:35b');
    expect(process.env.OLLAMA_HOST).toBe('http://ci-hub-ollama:11434');
  });

  it('does not clobber values that are already set explicitly', () => {
    process.env.OLLAMA_HOST = 'http://my-explicit-ollama:11434';
    const applied = applyHubEnv({ OLLAMA_HOST: 'http://host.docker.internal:11434' });

    expect(process.env.OLLAMA_HOST).toBe('http://my-explicit-ollama:11434');
    expect(applied).not.toContain('OLLAMA_HOST');
  });
});

describe('applyHubEnv (ci-mentra slug)', () => {
  it('maps the LLM_* keys the Hub hands the ci-mentra app', () => {
    const applied = applyHubEnv({
      OLLAMA_HOST: 'http://host.docker.internal:11434',
      LLM_API_BASE: 'http://host.docker.internal:11434/v1',
      LLM_API_KEY: 'ollama',
      LLM_DEFAULT_CHAT_MODEL: 'qwen3:8b',
    });

    expect(process.env.HERMES_OPENAI_BASE_URL).toBe('http://host.docker.internal:11434/v1');
    expect(process.env.HERMES_OPENAI_API_KEY).toBe('ollama');
    expect(process.env.HERMES_DEFAULT_MODEL).toBe('qwen3:8b');
    expect(process.env.LLM_DEFAULT_CHAT_MODEL).toBe('qwen3:8b');
    expect(applied).toEqual(expect.arrayContaining(['HERMES_OPENAI_BASE_URL', 'LLM_DEFAULT_CHAT_MODEL']));
  });
});

describe('resolveHubUrl', () => {
  it('prefers CI_HUB_URL, then the Hub-injected HUB_URL, then ci-hub:5002', () => {
    expect(resolveHubUrl({})).toBe('http://ci-hub:5002');
    expect(resolveHubUrl({ HUB_URL: 'http://ci-hub:5002/' })).toBe('http://ci-hub:5002');
    expect(resolveHubUrl({ HUB_URL: 'ci-os-hub:5002' })).toBe('http://ci-os-hub:5002');
    expect(resolveHubUrl({ HUB_URL: 'http://a', CI_HUB_URL: 'http://b:3000' })).toBe('http://b:3000');
  });
});

describe('applyHubInferenceBootstrap', () => {
  it('is a no-op when HUB_INFERENCE_BOOTSTRAP is not set', async () => {
    const result = await applyHubInferenceBootstrap();
    expect(result.attempted).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.slug).toBe('ci-mentra');
    expect(result.hubUrl).toBe('http://ci-hub:5002');
  });

  it('fails open when the Hub is unreachable', async () => {
    process.env.HUB_INFERENCE_BOOTSTRAP = 'true';
    // An unroutable/blackhole host so the request fails fast without a live Hub.
    process.env.CI_HUB_URL = 'http://127.0.0.1:1';
    const result = await applyHubInferenceBootstrap();
    expect(result.attempted).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
