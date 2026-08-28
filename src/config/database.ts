import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { env } from './env';
import { pgSslFor } from './pg-ssl';
import { applyTenantExtension } from '@shared/tenancy/prisma-tenant';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    ssl: pgSslFor(env.DATABASE_URL),
    max: env.DB_POOL_MAX ?? PRODUCT_LIMITS.poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    options: `-c statement_timeout=${env.DB_STATEMENT_TIMEOUT_MS ?? PRODUCT_LIMITS.statementTimeoutMs}`,
  });

const adapter = new PrismaPg(pool);

const basePrisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export const prisma = (globalForPrisma.prisma ??
  applyTenantExtension(basePrisma)) as unknown as PrismaClient;

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}
