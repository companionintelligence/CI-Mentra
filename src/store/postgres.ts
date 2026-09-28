import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { config } from '../config.ts';
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

/**
 * Apply `schema.sql` (every statement is IF NOT EXISTS, so this is idempotent).
 *
 * The repo's docker-compose mounts the file into Postgres' initdb, but a Hub
 * marketplace install runs a bare Postgres, so the bridge brings its own
 * tables. Paths resolve from the working directory (not `__dirname`, which
 * ESM lacks): `src/` for Deno / ts-node, `dist/` for the tsc build, or an
 * explicit MENTRA_SCHEMA_PATH. Fail-open: a missing or unreachable database is
 * logged, and only the Postgres-backed routes (/v1/responses) degrade.
 */
export async function ensureSchema(): Promise<boolean> {
  const cwd = process.cwd();
  const candidates = [
    process.env.MENTRA_SCHEMA_PATH,
    path.join(cwd, 'src', 'store', 'schema.sql'),
    path.join(cwd, 'dist', 'store', 'schema.sql'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    logger.warn({ candidates }, 'schema.sql not found; skipping schema bootstrap');
    return false;
  }
  try {
    await getPool().query(fs.readFileSync(file, 'utf8'));
    logger.info('database schema ensured');
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'could not ensure database schema (continuing)');
    return false;
  }
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
