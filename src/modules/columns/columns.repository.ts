import { inject, injectable } from 'tsyringe';
import {
  ColumnHistoryAction,
  ColumnSemanticRole,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { CreateColumnInput, UpdateColumnInput } from './columns.schemas';
import { inferSemanticRole } from './column-semantics';

@injectable()
export class ColumnsRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listActive(actionPlanId: string) {
    return this.prisma.actionColumn.findMany({
      where: { actionPlanId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listIncludingDeleted(actionPlanId: string) {
    return this.prisma.actionColumn.findMany({
      where: { actionPlanId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  findById(id: string, tenantId: string, actionPlanId?: string) {
    return this.prisma.actionColumn.findFirst({
      where: { id, tenantId, ...(actionPlanId ? { actionPlanId } : {}) },
    });
  }

  create(
    tenantId: string,
    actionPlanId: string,
    input: CreateColumnInput & { semanticRole?: ColumnSemanticRole },
  ) {
    const semanticRole =
      input.semanticRole ??
      inferSemanticRole({
        name: input.name,
        label: input.label,
        fieldType: input.fieldType,
      });
    return this.prisma.actionColumn.create({
      data: {
        tenantId,
        actionPlanId,
        name: input.name,
        label: input.label,
        fieldType: input.fieldType,
        semanticRole,
        required: input.required,
        options: input.options ?? undefined,
        sortOrder: input.sortOrder,
      },
    });
  }

  update(id: string, data: Prisma.ActionColumnUpdateInput) {
    return this.prisma.actionColumn.update({ where: { id }, data });
  }

  softDelete(id: string, deletedById: string, reason?: string) {
    return this.prisma.actionColumn.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        deletedById,
        deleteReason: reason,
      },
    });
  }

  async hardDeletePlanColumns(actionPlanId: string) {
    await this.prisma.actionColumn.deleteMany({ where: { actionPlanId } });
  }

  addHistory(data: {
    columnId: string;
    actorId?: string;
    action: ColumnHistoryAction;
    snapshot: Prisma.InputJsonValue;
  }) {
    return this.prisma.actionColumnHistory.create({ data });
  }

  listHistory(columnId: string) {
    return this.prisma.actionColumnHistory.findMany({
      where: { columnId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
  }
}
