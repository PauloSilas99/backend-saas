import { inject, injectable } from 'tsyringe';
import {
  ActionPriority,
  ActionStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { ListActionsQuery } from './action-plans.schemas';

@injectable()
export class ActionPlansRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listPlans(tenantId: string) {
    return this.prisma.actionPlan.findMany({
      where: { tenantId },
      include: {
        unit: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { rows: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findPlan(id: string, tenantId: string) {
    return this.prisma.actionPlan.findFirst({
      where: { id, tenantId },
      include: {
        unit: true,
        owner: { select: { id: true, name: true, email: true } },
        rows: {
          where: { deletedAt: null },
          include: {
            responsible: { select: { id: true, name: true, email: true } },
            unit: true,
            fieldValues: { include: { column: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  createPlan(data: {
    tenantId: string;
    ownerId: string;
    title: string;
    description?: string;
    unitId?: string;
    year?: number;
    month?: number;
  }) {
    return this.prisma.actionPlan.create({ data });
  }

  createRow(data: {
    actionPlanId: string;
    title: string;
    description?: string;
    unitId?: string;
    responsibleId?: string;
    status?: ActionStatus;
    priority?: ActionPriority;
    dueDate?: Date;
    externalKey?: string;
    responsibleName?: string;
    unitName?: string;
  }) {
    return this.prisma.actionPlanRow.create({ data });
  }

  findRow(id: string, tenantId: string, includeDeleted = false) {
    return this.prisma.actionPlanRow.findFirst({
      where: {
        id,
        actionPlan: { tenantId },
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      include: {
        actionPlan: true,
        responsible: { select: { id: true, name: true, email: true } },
        unit: true,
        fieldValues: { include: { column: true } },
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { actor: { select: { id: true, name: true, email: true } } },
        },
      },
    });
  }

  updateRow(id: string, data: Prisma.ActionPlanRowUpdateInput) {
    return this.prisma.actionPlanRow.update({ where: { id }, data });
  }

  async upsertFieldValues(
    actionRowId: string,
    tenantId: string,
    values: Record<string, unknown>,
  ) {
    const columns = await this.prisma.actionColumn.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { id: { in: Object.keys(values) } },
          { name: { in: Object.keys(values) } },
        ],
      },
    });

    const byKey = new Map<string, (typeof columns)[number]>();
    for (const col of columns) {
      byKey.set(col.id, col);
      byKey.set(col.name, col);
    }

    for (const [key, raw] of Object.entries(values)) {
      const column = byKey.get(key);
      if (!column) continue;
      await this.prisma.actionFieldValue.upsert({
        where: {
          actionRowId_columnId: { actionRowId, columnId: column.id },
        },
        create: {
          actionRowId,
          columnId: column.id,
          value: raw as Prisma.InputJsonValue,
        },
        update: {
          value: raw as Prisma.InputJsonValue,
        },
      });
    }
  }

  findPrimaryPlan(tenantId: string) {
    return this.prisma.actionPlan.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  updatePlan(
    id: string,
    data: { title?: string; description?: string; unitId?: string | null },
  ) {
    return this.prisma.actionPlan.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        unitId: data.unitId === undefined ? undefined : data.unitId,
      },
    });
  }

  getClient() {
    return this.prisma;
  }

  softDeleteRow(id: string) {
    return this.prisma.actionPlanRow.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  listRowsForUser(tenantId: string, responsibleId: string) {
    return this.prisma.actionPlanRow.findMany({
      where: {
        responsibleId,
        deletedAt: null,
        actionPlan: { tenantId },
      },
      include: {
        actionPlan: { select: { id: true, title: true } },
        unit: true,
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async listActions(tenantId: string, query: ListActionsQuery, scopeResponsibleId?: string) {
    const where: Prisma.ActionPlanRowWhereInput = {
      actionPlan: {
        tenantId,
        ...(query.actionPlanId ? { id: query.actionPlanId } : {}),
      },
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(scopeResponsibleId
        ? { responsibleId: scopeResponsibleId }
        : query.responsibleId
          ? { responsibleId: query.responsibleId }
          : {}),
      ...(query.from || query.to
        ? {
            dueDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { responsibleName: { contains: query.search, mode: 'insensitive' } },
              { unitName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.actionPlanRow.findMany({
        where,
        include: {
          actionPlan: { select: { id: true, title: true } },
          responsible: { select: { id: true, name: true, email: true } },
          unit: true,
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.actionPlanRow.count({ where }),
    ]);

    return { items, total };
  }

  listCalendar(tenantId: string, from: Date, to: Date, responsibleId?: string) {
    return this.prisma.actionPlanRow.findMany({
      where: {
        deletedAt: null,
        dueDate: { gte: from, lte: to },
        actionPlan: { tenantId },
        ...(responsibleId ? { responsibleId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        responsibleId: true,
        responsibleName: true,
        unitName: true,
        actionPlan: { select: { id: true, title: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  addHistory(data: {
    actionRowId: string;
    actorId?: string;
    fromStatus?: ActionStatus | null;
    toStatus?: ActionStatus | null;
    comment?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.actionHistory.create({
      data: {
        actionRowId: data.actionRowId,
        actorId: data.actorId,
        fromStatus: data.fromStatus ?? undefined,
        toStatus: data.toStatus ?? undefined,
        comment: data.comment,
        metadata: data.metadata,
      },
    });
  }

  duplicateRow(sourceId: string, data: Prisma.ActionPlanRowCreateInput) {
    return this.prisma.actionPlanRow.create({ data });
  }
}
