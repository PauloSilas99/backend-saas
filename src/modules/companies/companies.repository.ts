import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '@prisma/client';

@injectable()
export class CompaniesRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listAll() {
    return this.prisma.tenant.findMany({
      include: {
        _count: { select: { memberships: true, units: true } },
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.prisma.tenant.findUnique({
      where: { id },
      include: {
        units: true,
        subscription: { include: { plan: true } },
        _count: { select: { memberships: true } },
      },
    });
  }

  findBySlug(slug: string) {
    return this.prisma.tenant.findUnique({ where: { slug } });
  }

  create(data: { name: string; slug: string; document?: string }) {
    return this.prisma.tenant.create({ data });
  }

  update(id: string, data: { name?: string; document?: string; isActive?: boolean }) {
    return this.prisma.tenant.update({ where: { id }, data });
  }

  listUnits(tenantId: string) {
    return this.prisma.unit.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  createUnit(data: { tenantId: string; name: string; code?: string }) {
    return this.prisma.unit.create({ data });
  }
}
