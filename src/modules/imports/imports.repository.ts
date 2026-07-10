import { inject, injectable } from 'tsyringe';
import { ImportStatus, Prisma, PrismaClient } from '@prisma/client';

@injectable()
export class ImportsRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  create(data: {
    tenantId: string;
    createdById: string;
    filename: string;
    originalName: string;
    mimeType: string;
    status: ImportStatus;
    totalRows: number;
    previewData: Prisma.InputJsonValue;
    idempotencyKey: string;
    errorReport?: Prisma.InputJsonValue;
    errorRows?: number;
  }) {
    return this.prisma.import.create({ data });
  }

  findById(id: string, tenantId: string) {
    return this.prisma.import.findFirst({ where: { id, tenantId } });
  }

  findByIdempotencyKey(key: string) {
    return this.prisma.import.findUnique({ where: { idempotencyKey: key } });
  }

  update(id: string, data: Prisma.ImportUpdateInput) {
    return this.prisma.import.update({ where: { id }, data });
  }

  getClient() {
    return this.prisma;
  }
}
