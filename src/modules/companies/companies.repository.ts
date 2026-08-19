import { inject, injectable } from 'tsyringe';
import { PrismaClient, Role } from '@prisma/client';

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

  createWithOwner(data: {
    name: string;
    slug: string;
    document?: string;
    ownerUserId: string;
    role: Role;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          document: data.document,
        },
      });
      await tx.membership.create({
        data: {
          userId: data.ownerUserId,
          tenantId: tenant.id,
          role: data.role,
        },
      });
      return tx.tenant.findUniqueOrThrow({
        where: { id: tenant.id },
        include: {
          units: true,
          subscription: { include: { plan: true } },
          _count: { select: { memberships: true } },
        },
      });
    });
  }

  update(id: string, data: { name?: string; document?: string; isActive?: boolean }) {
    return this.prisma.tenant.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.prisma.tenant.update({
      where: { id },
      data: { isActive: false },
    });
  }

  listUnits(tenantId: string) {
    return this.prisma.unit.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  findUnit(id: string) {
    return this.prisma.unit.findUnique({ where: { id } });
  }

  createUnit(data: { tenantId: string; name: string; code?: string }) {
    return this.prisma.unit.create({ data });
  }

  updateUnit(id: string, data: { name?: string; code?: string; isActive?: boolean }) {
    return this.prisma.unit.update({ where: { id }, data });
  }

  softDeleteUnit(id: string) {
    return this.prisma.unit.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
