import { Pool } from 'pg';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'postgres' });

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.database.url });
    pool.on('error', (err) => logger.error({ err }, 'Unexpected postgres error'));
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const client = getPool();
  const start = Date.now();
  try {
    const res = await client.query(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: res.rowCount }, 'query executed');
    return res.rows as T[];
  } catch (err) {
    logger.error({ err, text }, 'query failed');
    throw err;
  }
}

export interface ConversationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  created_at: Date;
  last_activity_at: Date;
  title?: string;
  summary?: string;
  metadata_json: Record<string, unknown>;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content_json: unknown;
  created_at: Date;
  provider?: string;
  token_counts_json?: unknown;
}

export async function getOrCreateConversation(
  tenantId: string,
  userId: string,
  conversationId?: string
): Promise<ConversationRow> {
  if (conversationId) {
    const rows = await query<ConversationRow>(
      'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId]
    );
    if (rows.length > 0) return rows[0];
  }

  const rows = await query<ConversationRow>(
    `INSERT INTO conversations (tenant_id, user_id)
     VALUES ($1, $2)
     RETURNING *`,
    [tenantId, userId]
  );
  return rows[0];
}

export async function getConversationMessages(conversationId: string): Promise<MessageRow[]> {
  return query<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId]
  );
}

export async function appendMessage(
  conversationId: string,
  role: string,
  content: unknown,
  provider?: string,
  tokenCounts?: unknown
): Promise<MessageRow> {
  const rows = await query<MessageRow>(
    `INSERT INTO messages (conversation_id, role, content_json, provider, token_counts_json)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [conversationId, role, JSON.stringify(content), provider, tokenCounts ? JSON.stringify(tokenCounts) : null]
  );
  await query(
    'UPDATE conversations SET last_activity_at = NOW() WHERE id = $1',
    [conversationId]
  );
  return rows[0];
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
