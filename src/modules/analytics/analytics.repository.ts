import { inject, injectable } from 'tsyringe';
import { ActionStatus, Prisma, PrismaClient } from '@prisma/client';

export interface AnalyticsScope {
  tenantId: string;
  responsibleId?: string;
  unitId?: string;
  status?: ActionStatus;
  from?: Date;
  to?: Date;
}

@injectable()
export class AnalyticsRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  private buildWhere(scope: AnalyticsScope): Prisma.ActionPlanRowWhereInput {
    return {
      actionPlan: { tenantId: scope.tenantId },
      ...(scope.responsibleId ? { responsibleId: scope.responsibleId } : {}),
      ...(scope.unitId ? { unitId: scope.unitId } : {}),
      ...(scope.status ? { status: scope.status } : {}),
      ...(scope.from || scope.to
        ? {
            createdAt: {
              ...(scope.from ? { gte: scope.from } : {}),
              ...(scope.to ? { lte: scope.to } : {}),
            },
          }
        : {}),
    };
  }

  async getKpis(scope: AnalyticsScope) {
    const where = this.buildWhere(scope);
    const [total, completed, delayed, inProgress, pending] = await Promise.all([
      this.prisma.actionPlanRow.count({ where }),
      this.prisma.actionPlanRow.count({
        where: { ...where, status: ActionStatus.COMPLETED },
      }),
      this.prisma.actionPlanRow.count({
        where: { ...where, status: ActionStatus.DELAYED },
      }),
      this.prisma.actionPlanRow.count({
        where: { ...where, status: ActionStatus.IN_PROGRESS },
      }),
      this.prisma.actionPlanRow.count({
        where: { ...where, status: ActionStatus.PENDING },
      }),
    ]);

    const adherence = total === 0 ? 0 : Number(((completed / total) * 100).toFixed(2));

    return {
      total,
      completed,
      delayed,
      inProgress,
      pending,
      adherence,
      open: total - completed,
    };
  }

  async getMonthly(scope: AnalyticsScope) {
    const where = this.buildWhere(scope);
    const rows = await this.prisma.actionPlanRow.findMany({
      where,
      select: { createdAt: true, status: true, completedAt: true },
    });

    const buckets = new Map<string, { total: number; completed: number }>();

    for (const row of rows) {
      const date = row.createdAt;
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const current = buckets.get(key) ?? { total: 0, completed: 0 };
      current.total += 1;
      if (row.status === ActionStatus.COMPLETED) current.completed += 1;
      buckets.set(key, current);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => ({
        month,
        total: values.total,
        completed: values.completed,
        adherence:
          values.total === 0
            ? 0
            : Number(((values.completed / values.total) * 100).toFixed(2)),
      }));
  }

  async getByUnit(scope: AnalyticsScope) {
    const where = this.buildWhere(scope);
    const grouped = await this.prisma.actionPlanRow.groupBy({
      by: ['unitName', 'status'],
      where,
      _count: { _all: true },
    });

    const map = new Map<string, Record<string, number>>();
    for (const item of grouped) {
      const key = item.unitName ?? 'Sem unidade';
      const current = map.get(key) ?? {};
      current[item.status] = item._count._all;
      map.set(key, current);
    }

    return Array.from(map.entries()).map(([unit, statuses]) => ({
      unit,
      statuses,
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
    }));
  }

  async getByResponsible(scope: AnalyticsScope) {
    const where = this.buildWhere(scope);
    const grouped = await this.prisma.actionPlanRow.groupBy({
      by: ['responsibleName', 'status'],
      where,
      _count: { _all: true },
    });

    const map = new Map<string, Record<string, number>>();
    for (const item of grouped) {
      const key = item.responsibleName ?? 'Sem responsável';
      const current = map.get(key) ?? {};
      current[item.status] = item._count._all;
      map.set(key, current);
    }

    return Array.from(map.entries()).map(([responsible, statuses]) => ({
      responsible,
      statuses,
      total: Object.values(statuses).reduce((a, b) => a + b, 0),
      completed: statuses.COMPLETED ?? 0,
    }));
  }

  async getAdherence(scope: AnalyticsScope) {
    const kpis = await this.getKpis(scope);
    const byPriority = await this.prisma.actionPlanRow.groupBy({
      by: ['priority'],
      where: this.buildWhere(scope),
      _count: { _all: true },
    });

    return {
      overall: kpis.adherence,
      completed: kpis.completed,
      total: kpis.total,
      delayed: kpis.delayed,
      byPriority: byPriority.map((p) => ({
        priority: p.priority,
        total: p._count._all,
      })),
    };
  }
}
