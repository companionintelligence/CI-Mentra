const mockGet = jest.fn();
const mockPost = jest.fn();
const mockCreate = jest.fn(() => ({ get: mockGet, post: mockPost }));

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: (...args: unknown[]) => mockCreate(...(args as [])) },
}));

const mockConfig = {
  memory: {
    enabled: true,
    baseUrl: 'http://ci-server:8642',
    apiKey: 'memory-key',
    platform: 'mentra',
    recallMaxResults: 6,
  },
};
jest.mock('../../config', () => ({ config: mockConfig }));

import { getContext, recall, writeTurn, writeMemory, isMemoryEnabled } from '../../memory/companion-memory';

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.memory.enabled = true;
  mockConfig.memory.apiKey = 'memory-key';
});

describe('memory gating', () => {
  it('is disabled when the feature flag is off', async () => {
    mockConfig.memory.enabled = false;
    expect(isMemoryEnabled()).toBe(false);
    expect(await getContext()).toBe('');
    expect(await recall('q')).toEqual({ block: '', resultCount: 0 });
    expect(await writeMemory('x')).toBe(false);
    await writeTurn([{ role: 'user', content: 'hi' }], 's1');
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is disabled when no API key is configured', async () => {
    mockConfig.memory.apiKey = '';
    expect(isMemoryEnabled()).toBe(false);
    expect(await getContext()).toBe('');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('authentication', () => {
  it('sends the memory-scoped x-api-key (not a bearer token)', async () => {
    mockGet.mockResolvedValue({ data: { block: '## Profile' } });
    await getContext();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://ci-server:8642',
        headers: expect.objectContaining({ 'x-api-key': 'memory-key' }),
      })
    );
  });
});

describe('getContext', () => {
  it('returns the profile block', async () => {
    mockGet.mockResolvedValue({ data: { block: '## Profile\nLiam' } });
    expect(await getContext()).toBe('## Profile\nLiam');
    expect(mockGet).toHaveBeenCalledWith('/api/memory/context');
  });

  it('fails open to an empty block when CI-Server is unreachable', async () => {
    mockGet.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getContext()).resolves.toBe('');
  });

  it('tolerates an unexpected response shape', async () => {
    mockGet.mockResolvedValue({ data: {} });
    expect(await getContext()).toBe('');
  });
});

describe('recall', () => {
  it('posts the query with the configured recall depth', async () => {
    mockPost.mockResolvedValue({ data: { block: '## Relevant context', resultCount: 3 } });
    const result = await recall('gate code');
    expect(mockPost).toHaveBeenCalledWith('/api/memory/recall', { query: 'gate code', maxResults: 6 });
    expect(result).toEqual({ block: '## Relevant context', resultCount: 3 });
  });

  it('honors an explicit maxResults', async () => {
    mockPost.mockResolvedValue({ data: { block: '', resultCount: 0 } });
    await recall('q', 2);
    expect(mockPost).toHaveBeenCalledWith('/api/memory/recall', { query: 'q', maxResults: 2 });
  });

  it('skips empty queries and fails open on error', async () => {
    expect(await recall('   ')).toEqual({ block: '', resultCount: 0 });
    expect(mockPost).not.toHaveBeenCalled();

    mockPost.mockRejectedValue(new Error('boom'));
    await expect(recall('q')).resolves.toEqual({ block: '', resultCount: 0 });
  });
});

describe('writeTurn', () => {
  it('persists a turn with the platform tag', async () => {
    mockPost.mockResolvedValue({ data: { created: 2, skipped: 0 } });
    await writeTurn([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], 's1');
    expect(mockPost).toHaveBeenCalledWith('/api/memory/turn', {
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
      sessionId: 's1',
      platform: 'mentra',
    });
  });

  it('clamps long message content', async () => {
    mockPost.mockResolvedValue({ data: {} });
    await writeTurn([{ role: 'user', content: 'x'.repeat(5000) }], 's1');
    const body = mockPost.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toHaveLength(4000);
  });

  it('does nothing for an empty message list, and never throws on failure', async () => {
    await writeTurn([], 's1');
    expect(mockPost).not.toHaveBeenCalled();

    mockPost.mockRejectedValue(new Error('down'));
    await expect(writeTurn([{ role: 'user', content: 'hi' }], 's1')).resolves.toBeUndefined();
  });
});

describe('writeMemory', () => {
  it('stores a durable fragment and reports success', async () => {
    mockPost.mockResolvedValue({ data: { id: 'm1' } });
    const saved = await writeMemory('gate code is 4821', { sessionId: 's1', title: 'Gate' });
    expect(mockPost).toHaveBeenCalledWith('/api/memory/write', {
      content: 'gate code is 4821',
      title: 'Gate',
      source: 'mentra',
      sessionId: 's1',
    });
    expect(saved).toBe(true);
  });

  it('returns false on empty content or a failed write', async () => {
    expect(await writeMemory('  ')).toBe(false);
    mockPost.mockRejectedValue(new Error('nope'));
    expect(await writeMemory('something')).toBe(false);
  });
});
