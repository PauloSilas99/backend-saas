import { inject, injectable } from 'tsyringe';
import { randomBytes } from 'crypto';
import { PrismaClient, Role } from '@prisma/client';

@injectable()
export class UsersRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listByTenant(tenantId: string, q?: string) {
    return this.prisma.membership.findMany({
      where: {
        tenantId,
        ...(q
          ? {
              OR: [
                { user: { name: { contains: q, mode: 'insensitive' } } },
                { user: { email: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
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

  searchTypeahead(tenantId: string, q?: string) {
    return this.prisma.membership.findMany({
      where: {
        tenantId,
        isActive: true,
        user: {
          isActive: true,
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      take: 20,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { user: { name: 'asc' } },
    });
  }

  findMembership(userId: string, tenantId: string) {
    return this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });
  }

  findMembershipById(membershipId: string) {
    return this.prisma.membership.findUnique({
      where: { id: membershipId },
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
          emailVerifiedAt: new Date(),
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

  listAll(q?: string) {
    return this.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: {
        memberships: {
          include: { tenant: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        memberships: {
          include: { tenant: { select: { id: true, name: true } } },
        },
      },
    });
  }

  hardDeleteUser(userId: string, reassignToUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Referências opcionais → null
      await tx.actionPlanRow.updateMany({
        where: { responsibleId: userId },
        data: { responsibleId: null },
      });
      await tx.actionHistory.updateMany({
        where: { actorId: userId },
        data: { actorId: null },
      });
      await tx.actionColumnHistory.updateMany({
        where: { actorId: userId },
        data: { actorId: null },
      });
      await tx.actionColumn.updateMany({
        where: { deletedById: userId },
        data: { deletedById: null },
      });
      await tx.risk.updateMany({
        where: { ownerId: userId },
        data: { ownerId: null },
      });
      await tx.actionControl.updateMany({
        where: { responsibleId: userId },
        data: { responsibleId: null },
      });
      await tx.calendarActivity.updateMany({
        where: { assigneeId: userId },
        data: { assigneeId: null },
      });
      await tx.auditLog.updateMany({
        where: { userId },
        data: { userId: null },
      });

      // Referências obrigatórias → reatribuir ao admin que executa a exclusão
      await tx.actionPlan.updateMany({
        where: { ownerId: userId },
        data: { ownerId: reassignToUserId },
      });
      await tx.import.updateMany({
        where: { createdById: userId },
        data: { createdById: reassignToUserId },
      });
      await tx.calendarActivity.updateMany({
        where: { createdById: userId },
        data: { createdById: reassignToUserId },
      });
      await tx.calendarOverride.updateMany({
        where: { createdById: userId },
        data: { createdById: reassignToUserId },
      });

      // memberships / refreshTokens / authTokens / overlays → onDelete Cascade
      await tx.user.delete({ where: { id: userId } });
    });
  }

  deactivateAllMemberships(userId: string) {
    return this.prisma.membership.updateMany({
      where: { userId },
      data: { isActive: false },
    });
  }

  reactivatePrimaryMemberships(userId: string) {
    return this.prisma.membership.updateMany({
      where: { userId },
      data: { isActive: true },
    });
  }

  bumpTokenVersion(userId: string) {
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

export function generateTemporaryPassword(): string {
  return `Tmp@${randomBytes(4).toString('hex')}${randomBytes(2).toString('hex')}`;
}
