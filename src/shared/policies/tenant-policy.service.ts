import { inject, injectable } from 'tsyringe';
import { PrismaClient, Role } from '@prisma/client';

@injectable()
export class TenantPolicyService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async tenantHasActiveGestor(tenantId: string): Promise<boolean> {
    const count = await this.prisma.membership.count({
      where: {
        tenantId,
        role: Role.GESTOR,
        isActive: true,
        user: { isActive: true },
      },
    });
    return count > 0;
  }
}
