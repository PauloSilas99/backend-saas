import { prisma } from '@config/database';
import { env } from '@config/env';
import { getCacheRedis } from '@config/redis-cache';
import { getCachedDatabaseSize } from '@shared/health/database-stats';

export type HealthDepsResult = {
  database: 'ok' | 'error';
  databaseLatencyMs: number | null;
  databaseName: string | null;
  databaseSizeBytes: number | null;
  storageUsagePercent: number | null;
  freeStorageLimitBytes: number;
  redis: 'ok' | 'error';
  redisLatencyMs: number | null;
  redisHost: string | null;
  redisUsedMemoryBytes: number | null;
  redisUsedMemoryHuman: string | null;
  redisMaxMemoryBytes: number | null;
};

const FREE_STORAGE_LIMIT_BYTES = Math.floor(0.5 * 1024 * 1024 * 1024);

function redisHostLabel(redisUrl: string): string {
  try {
    const u = new URL(redisUrl);
    return u.hostname || 'redis';
  } catch {
    return 'redis';
  }
}

/** SELECT 1 + PING. Disco e memória Redis só com `details`. Sem RAM inventada. */
export async function probeHealthDeps(details: boolean): Promise<HealthDepsResult> {
  let database: 'ok' | 'error' = 'ok';
  let databaseLatencyMs: number | null = null;
  let databaseName: string | null = null;
  let databaseSizeBytes: number | null = null;

  try {
    const started = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    databaseLatencyMs = Date.now() - started;
    if (details) {
      const size = await getCachedDatabaseSize();
      if (size) {
        databaseSizeBytes = size.databaseSizeBytes;
        databaseName = size.databaseName;
      }
    }
  } catch {
    database = 'error';
  }

  let redis: 'ok' | 'error' = 'error';
  let redisLatencyMs: number | null = null;
  let redisUsedMemoryBytes: number | null = null;
  let redisUsedMemoryHuman: string | null = null;
  let redisMaxMemoryBytes: number | null = null;
  const redisHost = redisHostLabel(env.REDIS_URL);

  try {
    const client = getCacheRedis();
    if (client) {
      const started = Date.now();
      const pong = await client.ping();
      redisLatencyMs = Date.now() - started;
      if (pong === 'PONG') {
        redis = 'ok';
        if (details) {
          const info = await client.info('memory');
          const usedMatch = /used_memory:(\d+)/.exec(info);
          const usedHumanMatch = /used_memory_human:([^\r\n]+)/.exec(info);
          const maxMatch = /maxmemory:(\d+)/.exec(info);
          if (usedMatch) redisUsedMemoryBytes = Number(usedMatch[1]);
          if (usedHumanMatch) redisUsedMemoryHuman = usedHumanMatch[1].trim();
          if (maxMatch && Number(maxMatch[1]) > 0) {
            redisMaxMemoryBytes = Number(maxMatch[1]);
          }
        }
      }
    }
  } catch {
    redis = 'error';
  }

  const storagePct =
    databaseSizeBytes != null
      ? Math.min(100, Math.round((databaseSizeBytes / FREE_STORAGE_LIMIT_BYTES) * 1000) / 10)
      : null;

  return {
    database,
    databaseLatencyMs,
    databaseName,
    databaseSizeBytes,
    storageUsagePercent: storagePct,
    freeStorageLimitBytes: FREE_STORAGE_LIMIT_BYTES,
    redis,
    redisLatencyMs,
    redisHost,
    redisUsedMemoryBytes,
    redisUsedMemoryHuman,
    redisMaxMemoryBytes,
  };
}
