import axios from 'axios';
import { CanonicalTurn, CanonicalMessage } from '../canonical/types';
import { Provider, ProviderChatResponse, TranscriptionRequest, TranscriptionResponse, SpeechRequest } from './types';
import { Response } from 'express';
import { config } from '../config';
import pino from 'pino';
import FormData from 'form-data';

const logger = pino({ name: 'openai-provider' });

function messagesToMessages(messages: CanonicalMessage[]): Array<{ role: string; content: unknown }> {
  return messages.map(m => ({ role: m.role, content: m.content }));
}

export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || config.providers.openai.apiKey;
    this.baseUrl = baseUrl || config.providers.openai.baseUrl;
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
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
      presence_penalty: turn.generation_params.presence_penalty,
      frequency_penalty: turn.generation_params.frequency_penalty,
      tools: turn.tools,
    };

    const resp = await axios.post(`${this.baseUrl}/v1/chat/completions`, body, {
      headers: this.headers,
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
      presence_penalty: turn.generation_params.presence_penalty,
      frequency_penalty: turn.generation_params.frequency_penalty,
      tools: turn.tools,
    };

    const resp = await axios.post(`${this.baseUrl}/v1/chat/completions`, body, {
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

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResponse> {
    const form = new FormData();
    form.append('file', req.file, { filename: req.filename });
    form.append('model', req.model);
    if (req.language) form.append('language', req.language);
    if (req.prompt) form.append('prompt', req.prompt);
    if (req.response_format) form.append('response_format', req.response_format);

    const resp = await axios.post(`${this.baseUrl}/v1/audio/transcriptions`, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${this.apiKey}` },
      timeout: 60000,
    });
    return resp.data as TranscriptionResponse;
  }

  async speech(req: SpeechRequest): Promise<Buffer> {
    const resp = await axios.post(`${this.baseUrl}/v1/audio/speech`, {
      model: req.model,
      input: req.input,
      voice: req.voice,
      response_format: req.response_format || 'mp3',
      speed: req.speed || 1.0,
    }, {
      headers: this.headers,
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(resp.data as ArrayBuffer);
  }

  async listModels(): Promise<Array<{ id: string; created: number; owned_by: string }>> {
    try {
      const resp = await axios.get(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 10000,
      });
      const data = resp.data as { data?: Array<{ id: string; created?: number; owned_by?: string }> };
      return (data.data || []).map(m => ({
        id: m.id,
        created: m.created || 0,
        owned_by: m.owned_by || 'openai',
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to list OpenAI models');
      return [];
    }
  }
}
