import { inject, injectable } from 'tsyringe';
import { PrismaClient, Role } from '@prisma/client';

@injectable()
export class UsersRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listByTenant(tenantId: string) {
    return this.prisma.membership.findMany({
      where: { tenantId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMembership(userId: string, tenantId: string) {
    return this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });
  }

  async createInTenant(data: {
    name: string;
    email: string;
    passwordHash: string;
    tenantId: string;
    role: Role;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash: data.passwordHash,
        },
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: data.tenantId,
          role: data.role,
        },
      });

      return { user, membership };
    });
  }

  updateUser(userId: string, data: { name?: string; isActive?: boolean }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }

  updateMembership(membershipId: string, data: { role?: Role; isActive?: boolean }) {
    return this.prisma.membership.update({
      where: { id: membershipId },
      data,
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }
}
