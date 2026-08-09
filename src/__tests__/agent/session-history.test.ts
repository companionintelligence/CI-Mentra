const mockConfig = { agent: { maxHistoryTurns: 3 } };
jest.mock('../../config', () => ({ config: mockConfig }));

import {
  getHistory,
  appendExchange,
  contextIsFresh,
  setContext,
  getContextBlock,
  clearSession,
  pruneSessions,
  resetSessions,
} from '../../agent/session-history';

beforeEach(() => {
  resetSessions();
  mockConfig.agent.maxHistoryTurns = 3;
});

describe('session history', () => {
  it('starts empty and records an exchange as two messages', () => {
    expect(getHistory('s1')).toEqual([]);
    appendExchange('s1', 'hello', 'hi there');
    expect(getHistory('s1')).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('caps the rolling window at maxHistoryTurns exchanges, dropping the oldest', () => {
    for (let i = 1; i <= 5; i++) appendExchange('s1', `q${i}`, `a${i}`);
    const messages = getHistory('s1');
    // 3 turns * 2 messages
    expect(messages).toHaveLength(6);
    expect(messages[0]).toEqual({ role: 'user', content: 'q3' });
    expect(messages[messages.length - 1]).toEqual({ role: 'assistant', content: 'a5' });
  });

  it('keeps history isolated per session', () => {
    appendExchange('a', 'qa', 'aa');
    appendExchange('b', 'qb', 'ab');
    expect(getHistory('a')).toHaveLength(2);
    expect(getHistory('b')[0]).toEqual({ role: 'user', content: 'qb' });
  });

  it('caches the context block and reports freshness', () => {
    expect(contextIsFresh('s1')).toBe(false);
    setContext('s1', '## Profile\nLiam');
    expect(contextIsFresh('s1')).toBe(true);
    expect(getContextBlock('s1')).toContain('Liam');
  });

  it('treats an empty context block as fresh so we do not refetch every turn', () => {
    setContext('s1', '');
    expect(contextIsFresh('s1')).toBe(true);
    expect(getContextBlock('s1')).toBe('');
  });

  it('clears a session', () => {
    appendExchange('s1', 'q', 'a');
    clearSession('s1');
    expect(getHistory('s1')).toEqual([]);
  });

  it('prunes sessions older than the TTL', () => {
    appendExchange('old', 'q', 'a');
    // Two hours in the future — past the 1h session TTL.
    pruneSessions(Date.now() + 2 * 60 * 60 * 1000);
    expect(getHistory('old')).toEqual([]);
  });
});
