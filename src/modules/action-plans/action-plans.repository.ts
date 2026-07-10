import { inject, injectable } from 'tsyringe';
import { ActionPriority, ActionStatus, Prisma, PrismaClient } from '@prisma/client';

@injectable()
export class ActionPlansRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listPlans(tenantId: string, ownerId?: string) {
    return this.prisma.actionPlan.findMany({
      where: {
        tenantId,
        ...(ownerId ? { ownerId } : {}),
      },
      include: {
        unit: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { rows: true } },
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
          include: {
            responsible: { select: { id: true, name: true, email: true } },
            unit: true,
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

  findRow(id: string, tenantId: string) {
    return this.prisma.actionPlanRow.findFirst({
      where: { id, actionPlan: { tenantId } },
      include: { actionPlan: true },
    });
  }

  updateRow(id: string, data: Prisma.ActionPlanRowUpdateInput) {
    return this.prisma.actionPlanRow.update({ where: { id }, data });
  }

  listRowsForUser(tenantId: string, responsibleId: string) {
    return this.prisma.actionPlanRow.findMany({
      where: {
        responsibleId,
        actionPlan: { tenantId },
      },
      include: {
        actionPlan: { select: { id: true, title: true } },
        unit: true,
      },
      orderBy: { dueDate: 'asc' },
    });
  }
}
