import Redis from 'ioredis';
import { env } from './env';
import { logger } from '@shared/logger';

/** TTL padrão para meta leve (rowCount). */
export const SHEET_META_CACHE_TTL_SEC = 60;

let cacheClient: Redis | null | undefined;

/**
 * Cliente Redis para cache (separado do BullMQ).
 * Se Redis estiver fora, retorna null e o fluxo segue sem cache.
 */
export function getCacheRedis(): Redis | null {
  if (cacheClient === null) return null;
  if (cacheClient) return cacheClient;

  try {
    cacheClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
      lazyConnect: false,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 1000);
      },
    });
    cacheClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'redis.cache.error');
    });
    return cacheClient;
  } catch (err) {
    logger.warn({ err }, 'redis.cache.init_failed');
    cacheClient = null;
    return null;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  const redis = getCacheRedis();
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSec: number): Promise<void> {
  const redis = getCacheRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, 'EX', ttlSec);
  } catch {
    /* ignore */
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  const redis = getCacheRedis();
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    /* ignore */
  }
}

/** SET NX com TTL — trava simples (ex.: import por tenant). */
export async function cacheTryLock(key: string, ttlSec: number): Promise<boolean> {
  const redis = getCacheRedis();
  if (!redis) return true; // sem Redis: não bloqueia o fluxo
  try {
    const result = await redis.set(key, '1', 'EX', ttlSec, 'NX');
    return result === 'OK';
  } catch {
    return true;
  }
}

export async function cacheUnlock(key: string): Promise<void> {
  await cacheDel(key);
}

export function sheetRowCountCacheKey(
  tenantId: string,
  planId: string,
  scopeResponsibleId?: string,
): string {
  return `sheet:rowCount:${tenantId}:${planId}:${scopeResponsibleId ?? 'all'}`;
}

export function sheetJobLockKey(tenantId: string): string {
  return `sheet:job-lock:${tenantId}`;
}

export async function invalidateSheetRowCountCache(
  tenantId: string,
  planId: string,
): Promise<void> {
  // Chave sem scope (gestor) — scopes de operacional expiram pelo TTL.
  await cacheDel(sheetRowCountCacheKey(tenantId, planId));
}
