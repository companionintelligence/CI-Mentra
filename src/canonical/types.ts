export type StreamingMode = 'none' | 'sse';
export type OutputMode = 'text' | 'json' | 'tool_calls' | 'multimodal';
export type ProviderName = 'ollama' | 'vllm' | 'openai' | 'hermes';

export interface ContentPart {
  type: 'text' | 'image_url' | 'audio';
  text?: string;
  image_url?: { url: string; detail?: string };
  audio?: { data: string; format: string };
}

export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: ToolCallDelta[];
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallDelta {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface GenerationParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  seed?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
}

export interface CanonicalTurn {
  id: string;
  tenant_id: string;
  user_id: string;
  conversation_id?: string;
  model: string;
  input_messages: CanonicalMessage[];
  tools?: ToolSchema[];
  generation_params: GenerationParams;
  streaming_mode: StreamingMode;
  output_mode: OutputMode;
  provider?: ProviderName;
  previous_response_id?: string;
}

export interface CanonicalDelta {
  id: string;
  content?: string;
  tool_calls?: Partial<ToolCallDelta>[];
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
