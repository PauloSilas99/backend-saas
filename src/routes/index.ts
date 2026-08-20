import { Router } from 'express';
import { prisma } from '@config/database';
import { env } from '@config/env';
import { getCacheRedis } from '@config/redis-cache';
import authRoutes from '@modules/auth/auth.routes';
import usersRoutes from '@modules/users/users.routes';
import companiesRoutes from '@modules/companies/companies.routes';
import actionPlansRoutes from '@modules/action-plans/action-plans.routes';
import sheetsRoutes from '@modules/action-plan-sheets/sheets.routes';
import analyticsRoutes from '@modules/analytics/analytics.routes';
import billingRoutes from '@modules/billing/billing.routes';
import columnsRoutes from '@modules/columns/columns.routes';
import risksRoutes from '@modules/risks/risks.routes';
import calendarRoutes from '@modules/calendar/calendar.routes';
import empresasRoutes, {
  empresasMembersRouter,
  unidadesRouter,
} from '@modules/empresas/empresas.routes';

const router = Router();

function redisHostLabel(redisUrl: string): string {
  try {
    const u = new URL(redisUrl);
    return u.hostname || 'redis';
  } catch {
    return 'redis';
  }
}

router.get('/health', async (_req, res) => {
  const checkedAt = new Date().toISOString();
  let database: 'ok' | 'error' = 'ok';
  let databaseLatencyMs: number | null = null;
  let databaseSizeBytes: number | null = null;
  let databaseName: string | null = null;

  /** Plano Free Neon: storage 0.5 GB; compute até 2 CU ≈ 8 GB RAM. */
  const FREE_STORAGE_LIMIT_BYTES = Math.floor(0.5 * 1024 * 1024 * 1024);
  const FREE_RAM_LIMIT_MB = 8 * 1024;
  /** Compute mínimo típico ao acordar (0.25 CU ≈ 1 GB). */
  const FREE_RAM_ACTIVE_ESTIMATE_MB = 1024;

  try {
    const started = Date.now();
    const rows = await prisma.$queryRaw<
      Array<{ size_bytes: bigint | number; db_name: string }>
    >`SELECT pg_database_size(current_database())::bigint AS size_bytes, current_database() AS db_name`;
    databaseLatencyMs = Date.now() - started;
    const row = rows[0];
    if (row) {
      databaseSizeBytes = Number(row.size_bytes);
      databaseName = row.db_name;
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
  } catch {
    redis = 'error';
  }

  const storagePct =
    databaseSizeBytes != null
      ? Math.min(100, Math.round((databaseSizeBytes / FREE_STORAGE_LIMIT_BYTES) * 1000) / 10)
      : null;

  const status = database === 'ok' ? 'ok' : 'degraded';
  res.status(database === 'ok' ? 200 : 503).json({
    success: database === 'ok',
    data: {
      status,
      timestamp: checkedAt,
      checks: {
        api: 'ok',
        database,
        databaseLatencyMs,
        databaseName,
        databaseSizeBytes,
        freeStorageLimitBytes: FREE_STORAGE_LIMIT_BYTES,
        storageUsagePercent: storagePct,
        freeRamActiveEstimateMb: database === 'ok' ? FREE_RAM_ACTIVE_ESTIMATE_MB : 0,
        freeRamLimitMb: FREE_RAM_LIMIT_MB,
        provider: 'neon',
        plan: 'free',
        redis,
        redisLatencyMs,
        redisHost,
        redisUsedMemoryBytes,
        redisUsedMemoryHuman,
        redisMaxMemoryBytes,
      },
    },
  });
});


router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/companies', companiesRoutes);
router.use('/empresas', empresasRoutes);
router.use('/empresas/members', empresasMembersRouter);
router.use('/unidades', unidadesRouter);
router.use('/action-plans', actionPlansRoutes);
router.use('/action-plan-sheets', sheetsRoutes);
router.use('/imports', (_req, res) => {
  res.status(410).json({
    success: false,
    error: {
      code: 'IMPORTS_RETIRED',
      message:
        'A API /imports foi aposentada. Use POST /action-plan-sheets/parse-upload e POST /action-plan-sheets/import-from-parse.',
    },
  });
});
router.use('/analytics', analyticsRoutes);
router.use('/billing', billingRoutes);
router.use('/columns', columnsRoutes);
router.use('/risks', risksRoutes);
router.use('/calendar', calendarRoutes);

export default router;
