import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '@prisma/client';

interface AuditInput {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

@injectable()
export class AuditService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async log(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        metadata: input.metadata as object | undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }
}
