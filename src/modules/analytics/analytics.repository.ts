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
    const tenantId = scope.tenantId;
    const rows = await this.prisma.$queryRaw<
      Array<{ month: string; total: number; completed: number }>
    >`
      SELECT TO_CHAR(DATE_TRUNC('month', r.created_at), 'YYYY-MM') AS month,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed
      FROM action_plan_rows r
      INNER JOIN action_plans p ON p.id = r.action_plan_id
      WHERE p.tenant_id = ${tenantId}
        AND r.deleted_at IS NULL
        ${scope.responsibleId ? Prisma.sql`AND r.responsible_id = ${scope.responsibleId}` : Prisma.empty}
        ${scope.unitId ? Prisma.sql`AND r.unit_id = ${scope.unitId}` : Prisma.empty}
        ${scope.status ? Prisma.sql`AND r.status = ${scope.status}::"ActionStatus"` : Prisma.empty}
        ${scope.from ? Prisma.sql`AND r.created_at >= ${scope.from}` : Prisma.empty}
        ${scope.to ? Prisma.sql`AND r.created_at <= ${scope.to}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((row) => ({
      month: row.month,
      total: Number(row.total),
      completed: Number(row.completed),
      adherence:
        Number(row.total) === 0
          ? 0
          : Number(((Number(row.completed) / Number(row.total)) * 100).toFixed(2)),
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
