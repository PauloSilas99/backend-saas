import { inject, injectable } from 'tsyringe';
import {
  ColumnHistoryAction,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { CreateColumnInput, UpdateColumnInput } from './columns.schemas';

@injectable()
export class ColumnsRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listActive(tenantId: string) {
    return this.prisma.actionColumn.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listIncludingDeleted(tenantId: string) {
    return this.prisma.actionColumn.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  findById(id: string, tenantId: string) {
    return this.prisma.actionColumn.findFirst({ where: { id, tenantId } });
  }

  create(tenantId: string, input: CreateColumnInput) {
    return this.prisma.actionColumn.create({
      data: {
        tenantId,
        name: input.name,
        label: input.label,
        fieldType: input.fieldType,
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
