import type { CaptureRecord } from './records';

/** The signed-in person as the appliance reports them. */
export interface PortalUser {
  sub: string;
  name?: string;
  email?: string;
}

/** `GET /api/companion/status`. Answers 200 whether or not the caller is signed in. */
export interface CompanionStatus {
  authenticated: boolean;
  user: PortalUser | null;
  memoryEnabled: boolean;
  provider: string;
  model: string;
  oidcEnabled: boolean;
}

export interface AskResult {
  answer: string;
  remembered: boolean;
  sessionId: string;
}

export interface CaptureResult {
  memoryEnabled: boolean;
  saved: string[];
  failed: string[];
}

/** An answer from the appliance. `status` is 0 when the appliance could not be reached. */
export class CompanionApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CompanionApiError';
    this.status = status;
  }
}

export interface CompanionApiOptions {
  /** Origin of the appliance, as returned by normalizeApplianceUrl. */
  baseUrl: string;
  /** Replaced in tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface CompanionApi {
  status(token?: string): Promise<CompanionStatus>;
  ask(token: string, text: string, sessionId?: string): Promise<AskResult>;
  capture(token: string, records: readonly CaptureRecord[]): Promise<CaptureResult>;
  /** Where the glasses upload a photo. The SDK sends it as multipart form data. */
  photoUploadUrl(): string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function messageOf(payload: unknown): string | undefined {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
  }
  return undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createCompanionApi(options: CompanionApiOptions): CompanionApi {
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = options.baseUrl.replace(/\/+$/, '');

  async function call<T>(method: 'GET' | 'POST', path: string, token: string | undefined, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const response = await send(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new CompanionApiError(response.status, messageOf(payload) ?? `The appliance answered ${response.status}.`);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof CompanionApiError) {
        throw error;
      }
      throw new CompanionApiError(0, 'Could not reach the appliance.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    status: (token) => call<CompanionStatus>('GET', '/api/companion/status', token),
    ask: (token, text, sessionId) =>
      call<AskResult>('POST', '/api/companion/ask', token, sessionId ? { text, sessionId } : { text }),
    capture: (token, records) =>
      call<CaptureResult>('POST', '/api/companion/capture', token, { records: records.slice() }),
    photoUploadUrl: () => `${base}/api/companion/capture/photo`,
  };
}
