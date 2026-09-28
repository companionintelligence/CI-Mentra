const mockConfig = {
  memory: { platform: 'mentra' },
  agent: { persona: 'You are Companion.', language: 'en-US', maxHistoryTurns: 4 },
  providers: {
    default: 'ollama',
    ollama: { defaultModel: 'llama3.2' },
    hermes: { defaultModel: '' },
  },
};
jest.mock('../../config', () => ({ config: mockConfig }));

jest.mock('../../memory/companion-memory', () => ({
  getContext: jest.fn(),
  recall: jest.fn(),
  writeTurn: jest.fn(),
  writeMemory: jest.fn(),
  isMemoryEnabled: jest.fn(() => true),
}));

const chatCompletion = jest.fn();
jest.mock('../../providers', () => ({
  resolveProvider: jest.fn(() => ({ name: 'ollama', chatCompletion })),
}));

import { answer, parseRememberCommand, resolveDefaultModel } from '../../agent/answer-service.ts';
import * as memory from '../../memory/companion-memory.ts';
import { resetSessions, getHistory } from '../../agent/session-history.ts';

const mockedMemory = memory as jest.Mocked<typeof memory>;

function llmReply(content: string) {
  chatCompletion.mockResolvedValue({
    id: 'c1',
    model: 'llama3.2',
    choices: [{ index: 0, message: { role: 'assistant', content } }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSessions();
  mockConfig.providers.default = 'ollama';
  mockedMemory.getContext.mockResolvedValue('');
  mockedMemory.recall.mockResolvedValue({ block: '', resultCount: 0 });
  mockedMemory.writeTurn.mockResolvedValue(undefined);
  mockedMemory.writeMemory.mockResolvedValue(true);
});

describe('parseRememberCommand', () => {
  it('recognizes explicit remember phrasings and extracts the content', () => {
    expect(parseRememberCommand('remember that my wifi code is swordfish')).toBe('my wifi code is swordfish');
    expect(parseRememberCommand('Remember: gate code 1234')).toBe('gate code 1234');
    expect(parseRememberCommand('hey companion, remember to water the plants')).toBe('water the plants');
  });

  it('ignores utterances that are not a remember command', () => {
    expect(parseRememberCommand('what did I say about the wifi?')).toBeNull();
    expect(parseRememberCommand('do you remember')).toBeNull();
    expect(parseRememberCommand('')).toBeNull();
  });

  it('does not treat questions about memories as save commands', () => {
    // These ask the companion to RECALL, not to store. Matching them would
    // silently write junk into durable memory instead of answering.
    expect(parseRememberCommand('remember when we went to Rome?')).toBeNull();
    expect(parseRememberCommand('remember that trip we took?')).toBeNull();
    expect(parseRememberCommand('do you remember what I said about the wifi?')).toBeNull();
    expect(parseRememberCommand('remember where I parked?')).toBeNull();
    // No explicit save form ("remember when …") is a reminiscence, not a command.
    expect(parseRememberCommand('remember when we went to Rome')).toBeNull();
  });
});

describe('resolveDefaultModel', () => {
  it('uses the ollama model by default', () => {
    expect(resolveDefaultModel()).toBe('llama3.2');
  });

  it('prefers the hermes model when hermes is the default provider', () => {
    mockConfig.providers.default = 'hermes';
    mockConfig.providers.hermes.defaultModel = 'gemma4:latest';
    expect(resolveDefaultModel()).toBe('gemma4:latest');
    mockConfig.providers.hermes.defaultModel = '';
  });
});

describe('answer — remember command', () => {
  it('writes durable memory and confirms without calling the LLM', async () => {
    const result = await answer({ sessionId: 's1', text: 'remember that my gate code is 4821' });

    expect(mockedMemory.writeMemory).toHaveBeenCalledWith(
      'my gate code is 4821',
      expect.objectContaining({ sessionId: 's1', source: 'mentra' })
    );
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(result.remembered).toBe(true);
    expect(result.answer).toMatch(/remember/i);
    // still persisted as a turn + kept in session history
    expect(mockedMemory.writeTurn).toHaveBeenCalled();
    expect(getHistory('s1')).toHaveLength(2);
  });

  it('reports failure when the memory write fails', async () => {
    mockedMemory.writeMemory.mockResolvedValue(false);
    const result = await answer({ sessionId: 's1', text: 'remember the door is sticky' });
    expect(result.remembered).toBe(false);
    expect(result.answer).toMatch(/couldn't save/i);
  });
});

describe('answer — grounded generation', () => {
  it('grounds the prompt with persona, profile context and recalled memory', async () => {
    mockedMemory.getContext.mockResolvedValue('## Profile\nName: Liam');
    mockedMemory.recall.mockResolvedValue({ block: '## Relevant context\nGate code 4821', resultCount: 2 });
    llmReply('Your gate code is 4821.');

    const result = await answer({ sessionId: 's1', text: 'what is my gate code?' });

    expect(mockedMemory.recall).toHaveBeenCalledWith('what is my gate code?');
    const turn = chatCompletion.mock.calls[0][0];
    const system = turn.input_messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('You are Companion.');
    expect(system.content).toContain('Name: Liam');
    expect(system.content).toContain('Gate code 4821');
    expect(turn.input_messages[turn.input_messages.length - 1]).toEqual({
      role: 'user',
      content: 'what is my gate code?',
    });
    expect(turn.conversation_id).toBe('s1');

    expect(result.answer).toBe('Your gate code is 4821.');
    expect(result.usedRecallCount).toBe(2);
    expect(result.usedContext).toBe(true);
  });

  it('persists the exchange to long-term memory', async () => {
    llmReply('Hi!');
    await answer({ sessionId: 's1', text: 'hello' });
    expect(mockedMemory.writeTurn).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
      's1'
    );
  });

  it('carries prior turns into the next prompt (short-term memory)', async () => {
    llmReply('Blue.');
    await answer({ sessionId: 's1', text: 'my favorite color is blue' });
    llmReply('Blue, you told me.');
    await answer({ sessionId: 's1', text: 'what is my favorite color?' });

    const secondTurn = chatCompletion.mock.calls[1][0];
    const contents = secondTurn.input_messages.map((m: { content: string }) => m.content);
    expect(contents).toContain('my favorite color is blue');
    expect(contents).toContain('Blue.');
  });

  it('fetches profile context once per session, then reuses the cache', async () => {
    llmReply('ok');
    await answer({ sessionId: 's1', text: 'one' });
    await answer({ sessionId: 's1', text: 'two' });
    expect(mockedMemory.getContext).toHaveBeenCalledTimes(1);
  });

  it('falls back to a spoken-friendly error when the model call fails', async () => {
    chatCompletion.mockRejectedValue(new Error('connection refused'));
    const result = await answer({ sessionId: 's1', text: 'hello' });
    expect(result.answer).toMatch(/couldn't reach the assistant/i);
  });

  it('never persists a failed generation as a real turn', async () => {
    chatCompletion.mockRejectedValue(new Error('connection refused'));
    await answer({ sessionId: 's1', text: 'hello' });

    // Writing the apology would teach the wearer's permanent memory that their
    // companion said it, and poison later recall.
    expect(mockedMemory.writeTurn).not.toHaveBeenCalled();
    expect(getHistory('s1')).toEqual([]);
  });

  it('returns empty for blank input without touching memory or the model', async () => {
    const result = await answer({ sessionId: 's1', text: '   ' });
    expect(result.answer).toBe('');
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(mockedMemory.recall).not.toHaveBeenCalled();
  });
});
