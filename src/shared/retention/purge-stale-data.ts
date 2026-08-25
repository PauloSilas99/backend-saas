import { PrismaClient } from '@prisma/client';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';
import { logger } from '@shared/logger';

/**
 * Libera disco no Neon: lixo de import legado, tokens expirados e soft-deletes velhos.
 * Seguro para rodar em idle — só DELETE com filtro temporal.
 */
export async function purgeStaleData(prisma: PrismaClient): Promise<{
  importRows: number;
  imports: number;
  softDeletedRows: number;
  authTokens: number;
  refreshTokens: number;
}> {
  const softDeleteBefore = new Date(
    Date.now() - PRODUCT_LIMITS.softDeleteRetentionDays * 24 * 60 * 60 * 1000,
  );
  const authBefore = new Date(
    Date.now() - PRODUCT_LIMITS.authTokenRetentionDays * 24 * 60 * 60 * 1000,
  );

  const importRows = await prisma.importRow.deleteMany({
    where: {
      import: { status: { in: ['COMPLETED', 'FAILED', 'PARTIAL'] } },
    },
  });

  const imports = await prisma.import.deleteMany({
    where: {
      status: { in: ['COMPLETED', 'FAILED', 'PARTIAL'] },
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  const softDeletedRows = await prisma.actionPlanRow.deleteMany({
    where: { deletedAt: { lt: softDeleteBefore } },
  });

  const authTokens = await prisma.authToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: authBefore } }, { usedAt: { not: null, lt: authBefore } }],
    },
  });

  const refreshTokens = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: authBefore } },
        { revokedAt: { not: null, lt: authBefore } },
      ],
    },
  });

  const summary = {
    importRows: importRows.count,
    imports: imports.count,
    softDeletedRows: softDeletedRows.count,
    authTokens: authTokens.count,
    refreshTokens: refreshTokens.count,
  };

  logger.info(summary, 'retention.purge.completed');
  return summary;
}
