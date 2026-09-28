import axios from 'axios';
import { type CanonicalTurn, type CanonicalMessage } from '../canonical/types.ts';
import { type Provider, type ProviderChatResponse } from './types.ts';
import { type Response } from 'express';
import { config } from '../config.ts';
import pino from 'pino';

const logger = pino({ name: 'hermes-provider' });

function messagesToOpenAi(messages: CanonicalMessage[]): Array<{ role: string; content: unknown }> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Provider for the "backend hermes/openclaw server on CI-Hub".
 *
 * The Hub does not proxy inference; it hands each marketplace app (slug
 * `hermes-agent` / `openclaw`) an OpenAI-compatible endpoint. This provider
 * targets that endpoint — configured directly via `HERMES_OPENAI_BASE_URL`, or
 * discovered at startup from the Hub bootstrap (see `src/hub/inference-bootstrap.ts`).
 * If pointed at the Hermes agent's own API server it routes through the agent
 * (with its memory/tools/persona); if pointed at the Hub-provided Ollama `/v1`
 * it behaves like a plain model backend.
 */
export class HermesProvider implements Provider {
  readonly name = 'hermes';

  private get baseUrl(): string {
    return config.providers.hermes.baseUrl;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.providers.hermes.apiKey}`,
    };
  }

  /** Strip a `hermes:` / `openclaw:` routing prefix and apply the default model. */
  private resolveModel(model: string): string {
    const stripped = model.replace(/^(hermes|openclaw):/i, '').trim();
    return stripped || config.providers.hermes.defaultModel || model;
  }

  private ensureConfigured(): void {
    if (!this.baseUrl) {
      throw new Error(
        'Hermes/OpenClaw backend is not configured. Set HERMES_OPENAI_BASE_URL or enable Hub bootstrap (HUB_INFERENCE_BOOTSTRAP=true).'
      );
    }
  }

  private buildBody(turn: CanonicalTurn, stream: boolean) {
    return {
      model: this.resolveModel(turn.model),
      messages: messagesToOpenAi(turn.input_messages),
      stream,
      temperature: turn.generation_params.temperature,
      max_tokens: turn.generation_params.max_tokens,
      top_p: turn.generation_params.top_p,
      seed: turn.generation_params.seed,
      stop: turn.generation_params.stop,
      presence_penalty: turn.generation_params.presence_penalty,
      frequency_penalty: turn.generation_params.frequency_penalty,
      tools: turn.tools,
    };
  }

  async chatCompletion(turn: CanonicalTurn): Promise<ProviderChatResponse> {
    this.ensureConfigured();
    const resp = await axios.post(`${this.baseUrl}/v1/chat/completions`, this.buildBody(turn, false), {
      headers: this.headers,
      timeout: 120000,
    });
    return resp.data as ProviderChatResponse;
  }

  async chatCompletionStream(turn: CanonicalTurn, res: Response): Promise<void> {
    this.ensureConfigured();
    const resp = await axios.post(`${this.baseUrl}/v1/chat/completions`, this.buildBody(turn, true), {
      headers: this.headers,
      responseType: 'stream',
      timeout: 120000,
    });

    resp.data.on('data', (chunk: Buffer) => {
      res.write(chunk);
    });

    await new Promise<void>((resolve, reject) => {
      resp.data.on('end', resolve);
      resp.data.on('error', reject);
    });
  }

  async listModels(): Promise<Array<{ id: string; created: number; owned_by: string }>> {
    if (!this.baseUrl) return [];
    try {
      const resp = await axios.get(`${this.baseUrl}/v1/models`, { headers: this.headers, timeout: 10000 });
      const data = resp.data as { data?: Array<{ id: string; created?: number; owned_by?: string }> };
      return (data.data || []).map((m) => ({
        id: m.id,
        created: m.created || 0,
        owned_by: m.owned_by || 'hermes',
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to list Hermes/OpenClaw models');
      return [];
    }
  }
}
