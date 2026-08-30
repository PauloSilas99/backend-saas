import { inject, injectable } from 'tsyringe';
import { EvidenceKind, PrismaClient } from '@prisma/client';

@injectable()
export class EvidencesRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  create(data: {
    tenantId: string;
    actionRowId: string;
    kind: EvidenceKind;
    value?: string;
    publicId?: string;
    resourceType?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
    createdById: string;
  }) {
    return this.prisma.actionEvidence.create({ data });
  }

  findById(id: string, tenantId: string) {
    return this.prisma.actionEvidence.findFirst({ where: { id, tenantId } });
  }

  listByRow(actionRowId: string, tenantId: string) {
    return this.prisma.actionEvidence.findMany({
      where: { actionRowId, tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        value: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    });
  }

  remove(id: string) {
    return this.prisma.actionEvidence.delete({ where: { id } });
  }
}
