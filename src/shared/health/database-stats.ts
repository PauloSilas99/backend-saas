import { prisma } from '@config/database';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';
import { logger } from '@shared/logger';

type DbSizeSnapshot = {
  databaseName: string;
  databaseSizeBytes: number;
};

let snapshot: { at: number; value: DbSizeSnapshot } | null = null;
let inflight: Promise<DbSizeSnapshot | null> | null = null;

/**
 * pg_database_size é barato no Postgres, mas cada poll do admin vira egress + CU no Neon.
 * Cache em processo: um dyno, TTL curto, sem Redis.
 */
export async function getCachedDatabaseSize(): Promise<DbSizeSnapshot | null> {
  const now = Date.now();
  if (snapshot && now - snapshot.at < PRODUCT_LIMITS.healthDbStatsTtlMs) {
    return snapshot.value;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const rows = await prisma.$queryRaw<
        Array<{ size_bytes: bigint | number; db_name: string }>
      >`SELECT pg_database_size(current_database())::bigint AS size_bytes, current_database() AS db_name`;
      const row = rows[0];
      if (!row) return null;
      const value: DbSizeSnapshot = {
        databaseName: row.db_name,
        databaseSizeBytes: Number(row.size_bytes),
      };
      snapshot = { at: Date.now(), value };
      return value;
    } catch (err) {
      logger.warn({ err }, 'health.database_size.failed');
      return snapshot?.value ?? null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
