import Redis from 'ioredis';
import { env } from './env';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';
import { logger } from '@shared/logger';

/** TTL padrão para meta leve (rowCount, analytics). */
export const SHEET_META_CACHE_TTL_SEC = PRODUCT_LIMITS.sheetMetaCacheTtlSec;

let cacheClient: Redis | null | undefined;

const memoryLocks = new Map<string, number>();

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

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  await cacheSet(key, JSON.stringify(value), ttlSec);
}

/**
 * Lock exclusivo: Redis NX quando disponível; fallback em memória no mesmo processo.
 * Falha fechado (não permite dois imports no mesmo dyno se o Redis cair).
 */
export async function acquireExclusiveLock(key: string, ttlSec: number): Promise<boolean> {
  const now = Date.now();
  const localExpiry = memoryLocks.get(key);
  if (localExpiry && localExpiry > now) return false;

  const redis = getCacheRedis();
  if (redis) {
    try {
      const result = await redis.set(key, '1', 'EX', ttlSec, 'NX');
      if (result !== 'OK') return false;
      memoryLocks.set(key, now + ttlSec * 1000);
      return true;
    } catch {
      /* fallback local */
    }
  }

  memoryLocks.set(key, now + ttlSec * 1000);
  return true;
}

export async function releaseExclusiveLock(key: string): Promise<void> {
  memoryLocks.delete(key);
  await cacheDel(key);
}

/** @deprecated use acquireExclusiveLock — lock de import não pode falhar aberto. */
export async function cacheTryLock(key: string, ttlSec: number): Promise<boolean> {
  return acquireExclusiveLock(key, ttlSec);
}

export async function cacheUnlock(key: string): Promise<void> {
  await releaseExclusiveLock(key);
}

export function sheetRowCountCacheKey(
  tenantId: string,
  planId: string,
  scopeResponsibleId?: string,
): string {
  return `sheet:rowCount:${tenantId}:${planId}:${scopeResponsibleId ?? 'all'}`;
}

export function sheetAnalyticsCacheKey(
  tenantId: string,
  planId: string,
  scopeResponsibleId?: string,
): string {
  return `sheet:analytics:${tenantId}:${planId}:${scopeResponsibleId ?? 'all'}`;
}

export function sheetMetaCacheKey(tenantId: string, planId: string): string {
  return `sheet:meta:${tenantId}:${planId}`;
}

export function sessionCacheKey(userId: string): string {
  return `auth:session:${userId}`;
}

export function subscriptionCacheKey(tenantId: string): string {
  return `billing:sub:${tenantId}`;
}

export function sheetJobLockKey(tenantId: string): string {
  return `sheet:job-lock:${tenantId}`;
}

async function cacheDelByPrefix(prefix: string): Promise<void> {
  const redis = getCacheRedis();
  if (!redis) return;
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } catch {
    /* ignore */
  }
}

export async function invalidateSheetDataCaches(
  tenantId: string,
  planId: string,
): Promise<void> {
  await Promise.all([
    cacheDelByPrefix(`sheet:rowCount:${tenantId}:${planId}:`),
    cacheDelByPrefix(`sheet:analytics:${tenantId}:${planId}:`),
  ]);
}

export async function invalidateSheetCaches(tenantId: string, planId: string): Promise<void> {
  await invalidateSheetDataCaches(tenantId, planId);
  await cacheDel(sheetMetaCacheKey(tenantId, planId));
}

export async function invalidateSheetRowCountCache(
  tenantId: string,
  planId: string,
): Promise<void> {
  await invalidateSheetCaches(tenantId, planId);
}

export async function invalidateSessionCache(userId: string): Promise<void> {
  await cacheDel(sessionCacheKey(userId));
}

export async function invalidateSubscriptionCache(tenantId: string): Promise<void> {
  await cacheDel(subscriptionCacheKey(tenantId));
}
