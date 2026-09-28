const mockQuery = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: mockQuery, on: jest.fn() })),
}));

import { ensureSchema } from '../../store/postgres.ts';

describe('ensureSchema', () => {
  beforeEach(() => mockQuery.mockReset());

  it('applies the idempotent schema.sql', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(ensureSchema()).resolves.toBe(true);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
  });

  it('fails open when the database is unreachable', async () => {
    mockQuery.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(ensureSchema()).resolves.toBe(false);
  });
});
