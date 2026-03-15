import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'auth' });

export interface AuthenticatedRequest extends Request {
  tenantId: string;
  userId: string;
}

/**
 * Simple API key authentication middleware for the OpenAI facade.
 * Checks Bearer token in Authorization header.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        message: 'Missing or invalid Authorization header. Expected: Bearer <api_key>',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();

  // In production, validate against hashed keys in the database
  // For now, we validate against the configured facade API key (empty = allow all)
  if (config.facade.apiKey && apiKey !== config.facade.apiKey) {
    logger.warn({ ip: req.ip }, 'Invalid API key attempt');
    res.status(401).json({
      error: {
        message: 'Invalid API key.',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    });
    return;
  }

  // Attach tenant/user context (can be extended with DB lookup)
  (req as AuthenticatedRequest).tenantId = 'default';
  (req as AuthenticatedRequest).userId = 'default';

  next();
}
