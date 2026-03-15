import { Request, Response, NextFunction } from 'express';
import { incrRateLimit } from '../store/redis';
import { config } from '../config';
import { AuthenticatedRequest } from './auth';
import pino from 'pino';

const logger = pino({ name: 'rate-limit' });

/**
 * Per-tenant request rate limiting using Redis sliding window.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const tenantId = authReq.tenantId || 'anonymous';
  const key = `rl:rpm:${tenantId}`;

  incrRateLimit(key, 60)
    .then((count) => {
      if (count > config.rateLimit.rpm) {
        logger.warn({ tenantId, count }, 'Rate limit exceeded');
        res.status(429).json({
          error: {
            message: `Rate limit exceeded. Maximum ${config.rateLimit.rpm} requests per minute.`,
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
          },
        });
        return;
      }
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', config.rateLimit.rpm);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.rateLimit.rpm - count));
      next();
    })
    .catch((err) => {
      // Redis failure: allow request through (fail open)
      logger.error({ err }, 'Rate limit check failed, allowing request');
      next();
    });
}
