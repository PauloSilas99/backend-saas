import rateLimit from 'express-rate-limit';
import { env } from '@config/env';
import { apiRateLimitKey, authRateLimitKey } from './rate-limit-key';

export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  keyGenerator: apiRateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.method === 'GET' && /\/action-plan-sheets\/jobs\//.test(req.path),
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Muitas requisições. Tente novamente mais tarde.',
    },
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: authRateLimitKey,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Muitas tentativas de autenticação para esta conta. Tente novamente mais tarde.',
    },
  },
});
