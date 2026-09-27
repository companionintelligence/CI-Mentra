// eslint-disable-next-line @typescript-eslint/no-var-requires
const MentraEnv = require('../../public/env-builder.js');

function parse(env: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of env.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

describe('env-builder', () => {
  const base = { mentraApiKey: 'mk', facadeApiKey: 'fk', memoryKey: 'k'.repeat(64) };

  it('hub mode bootstraps inference from the Hub under the ci-mentra slug', () => {
    const env = parse(MentraEnv.build({ ...base, mode: 'hub' }));
    expect(env.HUB_INFERENCE_BOOTSTRAP).toBe('true');
    expect(env.HUB_APP_SLUG).toBe('ci-mentra');
    expect(env.CI_HUB_URL).toBe('http://ci-hub:5002');
    // The Hub supplies OLLAMA_HOST; pinning it would override a pool proxy.
    expect(env.OLLAMA_HOST).toBeUndefined();
    expect(env.DEFAULT_PROVIDER).toBe('hermes');
    expect(env.OLLAMA_BASE_URL).toBeUndefined();
  });

  it('compose mode points straight at Ollama', () => {
    const env = parse(MentraEnv.build({ ...base, mode: 'compose', ollamaUrl: 'http://gpu:11434/' }));
    expect(env.HUB_INFERENCE_BOOTSTRAP).toBe('false');
    expect(env.DEFAULT_PROVIDER).toBe('ollama');
    expect(env.OLLAMA_BASE_URL).toBe('http://gpu:11434');
    expect(env.DATABASE_URL).toContain('@postgres:5432');
  });

  it('writes the memory settings CI-Server expects', () => {
    const env = parse(MentraEnv.build({ ...base, memoryPrefix: '(none)' }));
    expect(env.MENTRA_MEMORY_ENABLED).toBe('true');
    expect(env.CI_SERVER_MEMORY_PATH_PREFIX).toBe('');
    expect(env.CI_SERVER_MEMORY_KEY).toBe('k'.repeat(64));
    expect(env.MENTRA_MEMORY_PLATFORM).toBe('mentra');
    expect(env.MENTRA_DEV_ALLOW_ANONYMOUS).toBe('false');
  });

  it('cannot be tricked into injecting extra keys via newlines', () => {
    const out = MentraEnv.build({ ...base, model: 'llama3\nMENTRA_DEV_ALLOW_ANONYMOUS=true' });
    expect(out.match(/^MENTRA_DEV_ALLOW_ANONYMOUS=/gm)).toHaveLength(1);
    expect(parse(out).MENTRA_DEV_ALLOW_ANONYMOUS).toBe('false');
  });

  it('quotes values with spaces or shell-special characters', () => {
    const env = parse(MentraEnv.build({ ...base, facadeApiKey: 'a b$c' }));
    expect(env.FACADE_API_KEY).toBe('"a b\\$c"');
  });

  it('validate flags the missing essentials', () => {
    const problems: string[] = MentraEnv.validate({ facadeApiKey: '', memoryKey: '' });
    expect(problems.join(' ')).toMatch(/MentraOS API key/);
    expect(problems.join(' ')).toMatch(/memory key/);
    expect(problems.join(' ')).toMatch(/open/);
    expect(MentraEnv.validate({ ...base })).toEqual([]);
  });

  it('commands differ per mode', () => {
    expect(MentraEnv.commands({ mode: 'tailscale' })).toContain('tailscale funnel 7010');
    expect(MentraEnv.commands({ mode: 'compose' })).toContain('docker compose up -d --build');
  });
});
