import axios from 'axios';
import pino from 'pino';

const logger = pino({ name: 'hub-bootstrap' });

/**
 * Result of attempting to adopt CI-Hub inference credentials at startup.
 */
export interface HubBootstrapResult {
  attempted: boolean;
  applied: boolean;
  slug: string;
  hubUrl: string;
  /** Canonical env vars this bootstrap populated. */
  keys: string[];
  reason?: string;
}

function isTruthy(rawValue: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((rawValue ?? '').trim());
}

function normalizeBaseUrl(rawValue: string | undefined): string {
  const value = rawValue?.trim();
  if (!value) return '';
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  return withProtocol.replace(/\/+$/, '');
}

/**
 * Parse a dotenv-style body (`KEY=value` per line) into a record. Ignores
 * blank lines and `#` comments, and strips matching surrounding quotes.
 */
export function parseDotenv(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function setIfAbsent(key: string, value: string | undefined, applied: string[]): void {
  if (!value) return;
  if (process.env[key] && process.env[key]!.trim() !== '') return; // explicit config wins
  process.env[key] = value;
  applied.push(key);
}

/**
 * Map the Hub's per-slug bootstrap.env into the canonical vars this app reads.
 *
 * The Hub hands out different key names per app slug:
 *   - hermes-agent → HERMES_OPENAI_BASE_URL / HERMES_OPENAI_API_KEY / HERMES_DEFAULT_MODEL
 *   - openclaw     → OPENAI_API_BASE / OPENAI_API_KEY / DEFAULT_MODEL
 *   - both         → OLLAMA_HOST (native Ollama base URL)
 * We normalize those into the HERMES_, OLLAMA_HOST, and HUB_LLM_ vars without
 * clobbering the generic OPENAI_ vars (which drive the separate OpenAI provider).
 */
export function applyHubEnv(hubEnv: Record<string, string>): string[] {
  const applied: string[] = [];

  const ollamaHost = normalizeBaseUrl(hubEnv.OLLAMA_HOST);
  const backendBase =
    normalizeBaseUrl(hubEnv.HERMES_OPENAI_BASE_URL) ||
    normalizeBaseUrl(hubEnv.OPENAI_API_BASE) ||
    normalizeBaseUrl(hubEnv.LLM_API_BASE) ||
    (ollamaHost ? `${ollamaHost}/v1` : '');
  const backendKey =
    hubEnv.HERMES_OPENAI_API_KEY || hubEnv.OPENAI_API_KEY || hubEnv.LLM_API_KEY || 'ollama';
  const backendModel =
    hubEnv.HERMES_DEFAULT_MODEL || hubEnv.DEFAULT_MODEL || hubEnv.LLM_DEFAULT_CHAT_MODEL || '';

  // Standardize the Ollama connection on the Hub's instance.
  setIfAbsent('OLLAMA_HOST', ollamaHost, applied);

  // Wire the hermes/openclaw backend provider.
  setIfAbsent('HERMES_OPENAI_BASE_URL', backendBase, applied);
  setIfAbsent('HERMES_OPENAI_API_KEY', backendKey, applied);
  setIfAbsent('HERMES_DEFAULT_MODEL', backendModel, applied);

  // Shared default chat model, if the Hub picked one for this hardware.
  setIfAbsent('LLM_DEFAULT_CHAT_MODEL', backendModel, applied);

  // Canonical mirror for observability / downstream consumers.
  setIfAbsent('HUB_LLM_BASE_URL', backendBase, applied);
  setIfAbsent('HUB_LLM_API_KEY', backendKey, applied);
  setIfAbsent('HUB_LLM_MODEL', backendModel, applied);

  return applied;
}

/**
 * Fetch this app's inference credentials from the CI-Hub and apply them to the
 * process environment before `config` is evaluated. Fail-open: any error (Hub
 * unreachable, 403 outside the internal network, timeout) is logged and
 * ignored so the app still starts with its configured/default endpoints.
 *
 * Enabled by `HUB_INFERENCE_BOOTSTRAP=true`. Uses `CI_HUB_URL`
 * (default `http://ci-os-hub:3000`) and `HUB_APP_SLUG`
 * (default `hermes-agent`; also `openclaw`).
 */
export async function applyHubInferenceBootstrap(): Promise<HubBootstrapResult> {
  const slug = process.env.HUB_APP_SLUG || 'hermes-agent';
  const hubUrl = normalizeBaseUrl(process.env.CI_HUB_URL) || 'http://ci-os-hub:3000';

  if (!isTruthy(process.env.HUB_INFERENCE_BOOTSTRAP)) {
    return { attempted: false, applied: false, slug, hubUrl, keys: [], reason: 'disabled' };
  }

  const url = `${hubUrl}/api/inference/apps/${encodeURIComponent(slug)}/bootstrap.env`;
  try {
    const resp = await axios.get(url, {
      timeout: 5000,
      responseType: 'text',
      // Accept any 2xx; anything else is treated as a soft failure below.
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const hubEnv = parseDotenv(typeof resp.data === 'string' ? resp.data : String(resp.data));
    const keys = applyHubEnv(hubEnv);
    logger.info({ slug, hubUrl, keys }, 'Applied CI-Hub inference credentials');
    return { attempted: true, applied: keys.length > 0, slug, hubUrl, keys };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ slug, url, reason }, 'CI-Hub inference bootstrap failed (continuing with configured endpoints)');
    return { attempted: true, applied: false, slug, hubUrl, keys: [], reason };
  }
}
