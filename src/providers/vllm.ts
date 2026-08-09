import axios from 'axios';
import { CanonicalTurn, CanonicalMessage } from '../canonical/types.ts';
import { Provider, ProviderChatResponse, TranscriptionRequest, TranscriptionResponse } from './types.ts';
import { Response } from 'express';
import { config } from '../config.ts';
import pino from 'pino';
import FormData from 'form-data';

const logger = pino({ name: 'vllm-provider' });

function messagesToMessages(messages: CanonicalMessage[]): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));
}

export class VllmProvider implements Provider {
  readonly name = 'vllm';
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.providers.vllm.baseUrl;
  }

  async chatCompletion(turn: CanonicalTurn): Promise<ProviderChatResponse> {
    const body = {
      model: turn.model,
      messages: messagesToMessages(turn.input_messages),
      stream: false,
      temperature: turn.generation_params.temperature,
      max_tokens: turn.generation_params.max_tokens,
      top_p: turn.generation_params.top_p,
      seed: turn.generation_params.seed,
      stop: turn.generation_params.stop,
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
      messages: messagesToMessages(turn.input_messages),
      stream: true,
      temperature: turn.generation_params.temperature,
      max_tokens: turn.generation_params.max_tokens,
      top_p: turn.generation_params.top_p,
      seed: turn.generation_params.seed,
      stop: turn.generation_params.stop,
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

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResponse> {
    const form = new FormData();
    form.append('file', req.file, { filename: req.filename });
    form.append('model', req.model);
    if (req.language) form.append('language', req.language);
    if (req.prompt) form.append('prompt', req.prompt);
    if (req.response_format) form.append('response_format', req.response_format);

    const resp = await axios.post(`${this.baseUrl}/v1/audio/transcriptions`, form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });
    return resp.data as TranscriptionResponse;
  }

  async listModels(): Promise<Array<{ id: string; created: number; owned_by: string }>> {
    try {
      const resp = await axios.get(`${this.baseUrl}/v1/models`, { timeout: 10000 });
      const data = resp.data as { data?: Array<{ id: string; created?: number; owned_by?: string }> };
      return (data.data || []).map(m => ({
        id: m.id,
        created: m.created || 0,
        owned_by: m.owned_by || 'vllm',
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to list vLLM models');
      return [];
    }
  }
}
