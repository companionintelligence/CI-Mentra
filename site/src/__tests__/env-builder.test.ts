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
  const base = { mentraApiKey: 'mk', facadeApiKey: 'fk', memoryKey: 'k'.repeat(64), speechUrl: 'http://speech:8000' };

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

  it('does not send visitors to a repository they cannot open', () => {
    for (const mode of ['hub', 'compose', 'tailscale']) {
      const text: string = MentraEnv.commands({ mode });
      expect(text).not.toContain('github.com/companionintelligence');
      expect(text).toContain('https://ci.computer/gg');
      expect(text).toContain('https://docs.ci.computer/docs/apps-available/first-party-apps/mentra-live');
    }
    expect(MentraEnv.commands({ mode: 'compose' })).toContain('git clone <repository URL you were given>');
  });

  describe('speech-to-text', () => {
    it('is required in every mode: the bridge has none of its own', () => {
      for (const mode of ['hub', 'compose', 'tailscale']) {
        const problems: string[] = MentraEnv.validate({ ...base, mode, speechUrl: '' });
        expect(problems.join(' ')).toMatch(/speech-to-text URL/i);
      }
    });

    it('writes the endpoint the bridge reads, and a comment when it is missing', () => {
      const env = parse(MentraEnv.build({ ...base, mode: 'hub', speechUrl: 'http://whisper:8000/' }));
      expect(env.OPENAI_BASE_URL).toBe('http://whisper:8000');
      expect(env.VLLM_BASE_URL).toBe('http://whisper:8000');
      expect(env.TTS_PROVIDER).toBe('mentra');
      const missing = MentraEnv.build({ ...base, speechUrl: '' });
      expect(parse(missing).OPENAI_BASE_URL).toBeUndefined();
      expect(missing).toMatch(/# Not set: the bridge has no speech-to-text of its own/);
    });

    it('drops a trailing /v1, which the bridge adds itself', () => {
      const env = parse(MentraEnv.build({ ...base, speechUrl: 'http://whisper:8000/v1/' }));
      expect(env.OPENAI_BASE_URL).toBe('http://whisper:8000');
      expect((MentraEnv.validate({ ...base, speechUrl: 'http://whisper:8000/v1' }) as string[]).join(' ')).toMatch(/trailing \/v1/);
    });

    it('names the field, not the variable, when a URL is malformed', () => {
      const problems: string[] = MentraEnv.validate({ ...base, speechUrl: 'whisper:8000', hubUrl: 'nope' });
      expect(problems).toContain('Speech-to-text URL must start with http:// or https://');
      expect(problems).toContain('Companion Hub URL must start with http:// or https://');
    });
  });

  it('flags the default database login as dev-only in the file it writes', () => {
    const out: string = MentraEnv.build({ ...base });
    expect(out).toMatch(/default postgres\/postgres login/);
    expect(out).toMatch(/Change it \(and POSTGRES_PASSWORD in docker-compose.yml\)/);
  });

  it('uses public product names in the file header', () => {
    const out: string = MentraEnv.build({ ...base });
    expect(out).toContain('# Companion for Mentra bridge');
    expect(out).not.toContain('CI-Mentra');
    expect(out).not.toContain('CI-Portal');
  });
});
