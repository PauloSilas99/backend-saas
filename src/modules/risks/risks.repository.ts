import { inject, injectable } from 'tsyringe';
import { Prisma, PrismaClient } from '@prisma/client';
import { ListRisksQuery } from './risks.schemas';

@injectable()
export class RisksRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async list(tenantId: string, query: ListRisksQuery, ownerId?: string) {
    const where: Prisma.RiskWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.risk.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          actionRow: { select: { id: true, title: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.risk.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string, tenantId: string) {
    return this.prisma.risk.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        actionRow: { select: { id: true, title: true, status: true } },
      },
    });
  }

  create(data: Prisma.RiskCreateInput) {
    return this.prisma.risk.create({ data });
  }

  update(id: string, data: Prisma.RiskUpdateInput) {
    return this.prisma.risk.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.prisma.risk.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
