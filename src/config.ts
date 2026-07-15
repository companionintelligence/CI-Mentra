import dotenv from 'dotenv';
dotenv.config();

function normalizeBaseUrl(rawValue: string | undefined, fallback: string, defaultProtocol: 'http' | 'https' = 'https'): string {
  const value = rawValue?.trim();
  if (!value) return fallback;

  const withProtocol = /^https?:\/\//i.test(value) ? value : `${defaultProtocol}://${value}`;
  return withProtocol.replace(/\/+$/, '');
}

/**
 * Strip a trailing OpenAI-style `/v1` segment from a base URL.
 * The Hub inference bootstrap and CI-Server summary service hand out
 * OpenAI-compatible endpoints that already end in `/v1` (e.g.
 * `http://host.docker.internal:11434/v1`), but the providers in this repo
 * append `/v1` themselves. Normalizing here keeps a single `/v1`.
 */
function stripOpenAiSuffix(baseUrl: string): string {
  return baseUrl.replace(/\/v1$/i, '');
}

function isTruthy(rawValue: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((rawValue ?? '').trim());
}

const runtimeMode = process.env.MENTRA_RUNTIME_MODE === 'bluetooth-local' ? 'bluetooth-local' : 'cloud';
const bluetoothTarget = process.env.MENTRA_BLUETOOTH_TARGET || 'mentra-live';

/**
 * Ollama base URL, standardized on the CI-Hub inference convention while
 * remaining local-first by default. Resolution order (first non-empty wins):
 *   1. OLLAMA_BASE_URL  — this repo's original var
 *   2. OLLAMA_HOST      — CI-Hub / CI-Server NestJS convention
 *   3. LLM_API_BASE     — CI-Hub bootstrap / CI-Server summary convention (may end in /v1)
 *   4. http://localhost:11434 (host-run Ollama default)
 * In a Hub-managed container the canonical value injected by the Hub is
 * `http://host.docker.internal:11434`.
 */
const ollamaBaseUrl = stripOpenAiSuffix(
  normalizeBaseUrl(
    process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || process.env.LLM_API_BASE,
    'http://localhost:11434',
    'http'
  )
);

/**
 * OpenAI-compatible endpoint of the "backend hermes/openclaw server on CI-Hub".
 * The Hub does not proxy inference; instead it hands each app (slug
 * `hermes-agent` / `openclaw`) an OpenAI-compatible endpoint via
 * `GET /api/inference/apps/<slug>/bootstrap.env`. That dotenv sets
 * `HERMES_OPENAI_BASE_URL`/`HERMES_OPENAI_API_KEY`/`HERMES_DEFAULT_MODEL`
 * (hermes) or `OPENAI_API_BASE`/`OPENAI_API_KEY`/`DEFAULT_MODEL` (openclaw).
 * `src/hub/inference-bootstrap.ts` fetches those and republishes them as the
 * canonical `HUB_LLM_*` vars, which we read here.
 */
const hubBackendBaseUrl = stripOpenAiSuffix(
  normalizeBaseUrl(
    process.env.HERMES_OPENAI_BASE_URL || process.env.OPENAI_API_BASE || process.env.HUB_LLM_BASE_URL,
    '',
    'http'
  )
);

export const config = {
  mentra: {
    packageName: process.env.MENTRA_PACKAGE_NAME || process.env.PACKAGE_NAME || 'com.companionintelligence.mentra-bridge',
    apiKey: process.env.MENTRA_API_KEY || process.env.MENTRAOS_API_KEY || '',
    port: parseInt(process.env.MENTRA_PORT || process.env.PORT || '7010'),
    cloudApiUrl: normalizeBaseUrl(process.env.MENTRA_CLOUD_API_URL, 'https://api.mentra.glass', 'https'),
  },
  facade: {
    port: parseInt(process.env.FACADE_PORT || '8080'),
    apiKey: process.env.FACADE_API_KEY || '',
  },
  /**
   * Authentication for the OpenAI-compatible facade.
   * - `portal`: OIDC login via CI-Portal (the platform IdP, better-auth). When
   *   enabled, the facade validates Portal-issued JWTs as a resource server
   *   (JWKS + iss/aud/exp checks), mirroring CI-Server's PortalTokenService.
   * - The static `facade.apiKey` remains a fallback for machine/dev clients.
   */
  auth: {
    portal: {
      enabled: isTruthy(process.env.PORTAL_OIDC_ENABLED),
      issuer: process.env.PORTAL_OIDC_ISSUER || 'https://hub.ci.computer/api/auth',
      jwksUri: normalizeBaseUrl(process.env.PORTAL_OIDC_JWKS_URI, 'https://hub.ci.computer/api/auth/jwks', 'https'),
      // aud on a Portal token equals the client_id it was minted for. Accept a
      // comma-separated allowlist of first-party clients (empty = skip aud check).
      audience: (process.env.PORTAL_OIDC_AUDIENCE || 'ci-mentra,ci-server,ci-hub')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    },
  },
  providers: {
    default: process.env.DEFAULT_PROVIDER || 'ollama',
    ollama: {
      baseUrl: ollamaBaseUrl,
      // Ollama ignores the key, but the Hub/CI-Server convention always sends a
      // non-empty bearer (`ollama`) so OpenAI-compatible clients don't choke.
      apiKey: process.env.OLLAMA_API_KEY || process.env.LLM_API_KEY || 'ollama',
      defaultModel: process.env.LLM_DEFAULT_CHAT_MODEL || process.env.OLLAMA_DEFAULT_MODEL || 'llama3.2',
    },
    vllm: { baseUrl: normalizeBaseUrl(process.env.VLLM_BASE_URL, 'http://localhost:8000', 'http') },
    openai: { apiKey: process.env.OPENAI_API_KEY || '', baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL, 'https://api.openai.com', 'https') },
    // The Hub-backed hermes/openclaw agent, exposed as an OpenAI-compatible provider.
    // The Hub bootstrap normalizes openclaw's OPENAI_API_KEY into HERMES_OPENAI_API_KEY,
    // so we don't read the generic OPENAI_API_KEY here (that drives the openai provider).
    hermes: {
      baseUrl: hubBackendBaseUrl,
      apiKey: process.env.HERMES_OPENAI_API_KEY || process.env.HUB_LLM_API_KEY || 'ollama',
      defaultModel: process.env.HERMES_DEFAULT_MODEL || process.env.HUB_LLM_MODEL || '',
    },
  },
  /**
   * CI-Hub integration. On startup (when `bootstrap` is enabled) CI-Mentra
   * fetches its inference credentials from the Hub the same way the
   * hermes-agent / openclaw marketplace apps do, so all three share one
   * standardized backend. Discovery is fail-open.
   */
  hub: {
    url: normalizeBaseUrl(process.env.CI_HUB_URL, 'http://ci-os-hub:3000', 'http'),
    // Which Hub app slug's inference credentials to adopt: hermes-agent | openclaw
    appSlug: process.env.HUB_APP_SLUG || 'hermes-agent',
    bootstrap: isTruthy(process.env.HUB_INFERENCE_BOOTSTRAP),
  },
  database: { url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mentra' },
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
  audio: {
    baseUrl: process.env.AUDIO_BASE_URL || 'http://localhost:8080',
    ttsProvider: process.env.TTS_PROVIDER || 'mentra',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    elevenlabsDefaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
  },
  rateLimit: {
    rpm: parseInt(process.env.RATE_LIMIT_RPM || '60'),
    tpm: parseInt(process.env.RATE_LIMIT_TPM || '100000'),
  },
  runtime: {
    mode: runtimeMode,
    bluetooth: {
      sdkPackage: '@mentra/bluetooth-sdk',
      sdkVersion: process.env.MENTRA_BLUETOOTH_SDK_VERSION || '0.1.6',
      packagePath: process.env.MENTRA_BLUETOOTH_SDK_PACKAGE_PATH || '',
      target: bluetoothTarget,
    },
  },
};
