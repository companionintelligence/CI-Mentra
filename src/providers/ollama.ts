import axios from 'axios';
import { CanonicalTurn, CanonicalMessage } from '../canonical/types';
import { Provider, ProviderChatResponse } from './types';
import { Response } from 'express';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'ollama-provider' });

function messagesToOllama(messages: CanonicalMessage[]): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));
}

export class OllamaProvider implements Provider {
  readonly name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.providers.ollama.baseUrl;
  }

  async chatCompletion(turn: CanonicalTurn): Promise<ProviderChatResponse> {
    const body = {
      model: turn.model,
      messages: messagesToOllama(turn.input_messages),
      stream: false,
      options: {
        temperature: turn.generation_params.temperature,
        num_predict: turn.generation_params.max_tokens,
        top_p: turn.generation_params.top_p,
        seed: turn.generation_params.seed,
      },
      tools: turn.tools,
    };

    const resp = await axios.post(`${this.baseUrl}/v1/chat/completions`, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
    });
    return resp.data as ProviderChatResponse;
  }

  async chatCompletionStream(turn: CanonicalTurn, res: Response): Promise<void> {
    const body = {
      model: turn.model,
      messages: messagesToOllama(turn.input_messages),
      stream: true,
      options: {
        temperature: turn.generation_params.temperature,
        num_predict: turn.generation_params.max_tokens,
        top_p: turn.generation_params.top_p,
        seed: turn.generation_params.seed,
      },
      tools: turn.tools,
    };

    const resp = await axios.post(`${this.baseUrl}/v1/chat/completions`, body, {
      headers: { 'Content-Type': 'application/json' },
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
    try {
      const resp = await axios.get(`${this.baseUrl}/v1/models`, { timeout: 10000 });
      const data = resp.data as { data?: Array<{ id: string; created?: number; owned_by?: string }> };
      return (data.data || []).map(m => ({
        id: m.id,
        created: m.created || 0,
        owned_by: m.owned_by || 'ollama',
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to list Ollama models');
      return [];
    }
  }
}
