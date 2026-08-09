import { v4 as uuidv4 } from 'uuid';
import {
  CanonicalTurn, CanonicalMessage, ToolSchema, GenerationParams, StreamingMode, OutputMode,
} from './types.ts';

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
  tools?: ToolSchema[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  seed?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  stream_options?: { include_usage?: boolean };
}

export interface ResponsesRequest {
  model: string;
  input: string | CanonicalMessage[];
  instructions?: string;
  tools?: ToolSchema[];
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  seed?: number;
  previous_response_id?: string;
}

export function normalizeChatCompletionToCanonical(
  req: ChatCompletionRequest,
  tenantId: string,
  userId: string,
): CanonicalTurn {
  const messages: CanonicalMessage[] = req.messages.map(m => ({
    role: m.role as CanonicalMessage['role'],
    content: m.content as CanonicalMessage['content'],
  }));

  const generation_params: GenerationParams = {
    temperature: req.temperature,
    max_tokens: req.max_tokens,
    top_p: req.top_p,
    seed: req.seed,
    stop: req.stop,
    presence_penalty: req.presence_penalty,
    frequency_penalty: req.frequency_penalty,
  };

  const hasTools = (req.tools?.length ?? 0) > 0;
  const output_mode: OutputMode = hasTools ? 'tool_calls' : 'text';
  const streaming_mode: StreamingMode = req.stream ? 'sse' : 'none';

  return {
    id: uuidv4(),
    tenant_id: tenantId,
    user_id: userId,
    model: req.model,
    input_messages: messages,
    tools: req.tools,
    generation_params,
    streaming_mode,
    output_mode,
  };
}

export function normalizeResponsesRequestToCanonical(
  req: ResponsesRequest,
  tenantId: string,
  userId: string,
): CanonicalTurn {
  const messages: CanonicalMessage[] = [];

  if (req.instructions) {
    messages.push({ role: 'system', content: req.instructions });
  }

  if (typeof req.input === 'string') {
    messages.push({ role: 'user', content: req.input });
  } else if (Array.isArray(req.input)) {
    messages.push(...req.input);
  }

  const generation_params: GenerationParams = {
    temperature: req.temperature,
    max_tokens: req.max_output_tokens,
    top_p: req.top_p,
    seed: req.seed,
  };

  const hasTools = (req.tools?.length ?? 0) > 0;
  const output_mode: OutputMode = hasTools ? 'tool_calls' : 'text';
  const streaming_mode: StreamingMode = req.stream ? 'sse' : 'none';

  return {
    id: uuidv4(),
    tenant_id: tenantId,
    user_id: userId,
    model: req.model,
    input_messages: messages,
    tools: req.tools,
    generation_params,
    streaming_mode,
    output_mode,
    previous_response_id: req.previous_response_id,
  };
}
