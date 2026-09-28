import type { CanonicalTurn } from '../canonical/types.ts';
import { type Response } from 'express';

export interface ProviderChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: unknown[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  seed?: number;
  stop?: string | string[];
}

export interface ProviderChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message?: { role: string; content: string; tool_calls?: unknown[] };
    delta?: { role?: string; content?: string; tool_calls?: unknown[] };
    finish_reason?: string;
    index: number;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface TranscriptionRequest {
  file: Buffer;
  filename: string;
  model: string;
  language?: string;
  prompt?: string;
  response_format?: string;
  temperature?: number;
}

export interface TranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface SpeechRequest {
  model: string;
  input: string;
  voice: string;
  response_format?: string;
  speed?: number;
}

export interface Provider {
  name: string;
  chatCompletion(turn: CanonicalTurn): Promise<ProviderChatResponse>;
  chatCompletionStream(turn: CanonicalTurn, res: Response): Promise<void>;
  transcribe?(req: TranscriptionRequest): Promise<TranscriptionResponse>;
  speech?(req: SpeechRequest): Promise<Buffer>;
  listModels(): Promise<Array<{ id: string; created: number; owned_by: string }>>;
}
