import { Redis } from 'ioredis';
import { config } from '../config.ts';
import pino from 'pino';

const logger = pino({ name: 'redis' });

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });
    redisClient.on('error', (err: Error) => logger.error({ err }, 'Redis error'));
    redisClient.on('connect', () => logger.info('Redis connected'));
  }
  return redisClient;
}

export async function setSessionState(sessionId: string, state: Record<string, unknown>, ttlSeconds = 3600): Promise<void> {
  const redis = getRedis();
  await redis.set(`session:${sessionId}`, JSON.stringify(state), 'EX', ttlSeconds);
}

export async function getSessionState(sessionId: string): Promise<Record<string, unknown> | null> {
  const redis = getRedis();
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) as Record<string, unknown> : null;
}

export async function deleteSessionState(sessionId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`session:${sessionId}`);
}

export async function incrRateLimit(key: string, windowSeconds: number): Promise<number> {
  const redis = getRedis();
  const multi = redis.multi();
  multi.incr(key);
  multi.expire(key, windowSeconds);
  const results = await multi.exec();
  return (results?.[0]?.[1] as number) || 0;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
