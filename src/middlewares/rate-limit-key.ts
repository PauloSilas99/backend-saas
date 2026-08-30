import { createHash } from 'node:crypto';
import type { Request } from 'express';

function bearerToken(req: Request): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function ipKey(req: Request): string {
  return `ip:${req.ip ?? 'desconhecido'}`;
}

export function apiRateLimitKey(req: Request): string {
  const token = bearerToken(req);
  return token ? `sessao:${digest(token)}` : ipKey(req);
}

export function authRateLimitKey(req: Request): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email ? `conta:${digest(email)}` : ipKey(req);
}
