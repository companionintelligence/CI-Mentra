import { normalizeChatCompletionToCanonical, normalizeResponsesRequestToCanonical } from '../../canonical/normalizer.ts';

describe('normalizeChatCompletionToCanonical', () => {
  it('should normalize a basic chat completion request', () => {
    const req = {
      model: 'llama3.2',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ],
    };

    const turn = normalizeChatCompletionToCanonical(req, 'tenant1', 'user1');

    expect(turn.model).toBe('llama3.2');
    expect(turn.input_messages).toHaveLength(2);
    expect(turn.input_messages[0].role).toBe('system');
    expect(turn.input_messages[1].role).toBe('user');
    expect(turn.streaming_mode).toBe('none');
    expect(turn.tenant_id).toBe('tenant1');
    expect(turn.user_id).toBe('user1');
  });

  it('should set streaming_mode to sse when stream=true', () => {
    const req = {
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    };

    const turn = normalizeChatCompletionToCanonical(req, 'tenant1', 'user1');
    expect(turn.streaming_mode).toBe('sse');
  });

  it('should set output_mode to tool_calls when tools are provided', () => {
    const req = {
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'What time is it?' }],
      tools: [{
        type: 'function' as const,
        function: { name: 'get_time', description: 'Get current time', parameters: {} },
      }],
    };

    const turn = normalizeChatCompletionToCanonical(req, 'tenant1', 'user1');
    expect(turn.output_mode).toBe('tool_calls');
    expect(turn.tools).toHaveLength(1);
  });

  it('should pass generation params', () => {
    const req = {
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      max_tokens: 512,
      top_p: 0.9,
    };

    const turn = normalizeChatCompletionToCanonical(req, 'tenant1', 'user1');
    expect(turn.generation_params.temperature).toBe(0.7);
    expect(turn.generation_params.max_tokens).toBe(512);
    expect(turn.generation_params.top_p).toBe(0.9);
  });
});

describe('normalizeResponsesRequestToCanonical', () => {
  it('should normalize a string input', () => {
    const req = { model: 'llama3.2', input: 'Hello!' };

    const turn = normalizeResponsesRequestToCanonical(req, 'tenant1', 'user1');
    expect(turn.input_messages).toHaveLength(1);
    expect(turn.input_messages[0].role).toBe('user');
    expect(turn.input_messages[0].content).toBe('Hello!');
  });

  it('should prepend system message from instructions', () => {
    const req = {
      model: 'llama3.2',
      input: 'Hello!',
      instructions: 'You are a helpful assistant.',
    };

    const turn = normalizeResponsesRequestToCanonical(req, 'tenant1', 'user1');
    expect(turn.input_messages).toHaveLength(2);
    expect(turn.input_messages[0].role).toBe('system');
    expect(turn.input_messages[0].content).toBe('You are a helpful assistant.');
  });

  it('should preserve previous_response_id', () => {
    const req = {
      model: 'llama3.2',
      input: 'Follow up question',
      previous_response_id: 'resp_abc123',
    };

    const turn = normalizeResponsesRequestToCanonical(req, 'tenant1', 'user1');
    expect(turn.previous_response_id).toBe('resp_abc123');
  });
});
