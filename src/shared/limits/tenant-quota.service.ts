import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { QuotaError } from '@shared/errors/AppError';
import {
  PRODUCT_LIMITS,
  columnQuotaMessage,
  rowQuotaMessage,
} from './product-limits';

@injectable()
export class TenantQuotaService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  countRows(tenantId: string) {
    return this.prisma.actionPlanRow.count({
      where: { actionPlan: { tenantId } },
    });
  }

  async remainingRows(tenantId: string): Promise<number> {
    const used = await this.countRows(tenantId);
    return Math.max(0, PRODUCT_LIMITS.maxRowsPerTenant - used);
  }

  async assertCanAddRows(tenantId: string, additional: number): Promise<void> {
    if (additional <= 0) return;
    const remaining = await this.remainingRows(tenantId);
    if (additional > remaining) {
      throw new QuotaError(rowQuotaMessage(), {
        remaining,
        additional,
        limit: PRODUCT_LIMITS.maxRowsPerTenant,
      });
    }
  }

  countActiveColumns(actionPlanId: string) {
    return this.prisma.actionColumn.count({
      where: { actionPlanId, deletedAt: null },
    });
  }

  async assertCanAddColumns(actionPlanId: string, additional: number): Promise<void> {
    if (additional <= 0) return;
    const used = await this.countActiveColumns(actionPlanId);
    const remaining = Math.max(0, PRODUCT_LIMITS.maxColumnsPerSheet - used);
    if (additional > remaining) {
      throw new QuotaError(columnQuotaMessage(), {
        remaining,
        additional,
        limit: PRODUCT_LIMITS.maxColumnsPerSheet,
      });
    }
  }
}
