import { inject, injectable } from 'tsyringe';
import { AuthTokenType, PrismaClient, Role } from '@prisma/client';

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
    whatsapp: string;
    tenantName: string;
    tenantSlug: string;
    role: Role;
    /** Se true, e-mail já entra como confirmado (fluxo sem SMTP). */
    emailVerified?: boolean;
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
          whatsapp: data.whatsapp,
          emailVerifiedAt: data.emailVerified ? new Date() : null,
          isActive: false,
        },
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: data.role,
          isActive: false,
        },
      });

      const starterPlan = await tx.plan.findFirst({
        where: { code: 'starter', isActive: true },
      });

      if (starterPlan) {
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: starterPlan.id,
            status: 'TRIALING',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        });
      }

      return { user, tenant, membership };
    });
  }

  createRefreshToken(data: {
    userId: string;
    tenantId?: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
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

  invalidateAuthTokens(userId: string, type: AuthTokenType) {
    return this.prisma.authToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  createAuthToken(data: {
    userId: string;
    type: AuthTokenType;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.prisma.authToken.create({ data });
  }

  findValidAuthToken(tokenHash: string, type: AuthTokenType) {
    return this.prisma.authToken.findFirst({
      where: {
        tokenHash,
        type,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
  }

  markAuthTokenUsed(id: string) {
    return this.prisma.authToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  markEmailVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  updatePassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
  }

  updateProfile(userId: string, data: { name?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }
}
