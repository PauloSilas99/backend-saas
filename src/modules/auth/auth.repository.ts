import { inject, injectable } from 'tsyringe';
import { PrismaClient, Role } from '@prisma/client';

@injectable()
export class AuthRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { isActive: true },
          include: { tenant: true },
        },
      },
    });
  }

  findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { isActive: true },
          include: { tenant: true },
        },
      },
    });
  }

  createUserWithTenant(data: {
    name: string;
    email: string;
    passwordHash: string;
    tenantName: string;
    tenantSlug: string;
    role: Role;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.tenantName,
          slug: data.tenantSlug,
        },
      });

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
          tenantId: tenant.id,
          role: data.role,
        },
      });

      return { user, tenant, membership };
    });
  }

  createRefreshToken(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.prisma.refreshToken.create({ data });
  }

  findRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: {
        user: {
          include: {
            memberships: {
              where: { isActive: true },
              include: { tenant: true },
            },
          },
        },
      },
    });
  }

  revokeRefreshToken(id: string) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllUserTokens(userId: string) {
    return this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }
}
