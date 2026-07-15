import { inject, injectable } from 'tsyringe';
import {
  ImportRowStatus,
  ImportStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { DEFAULT_PAGE_SIZE } from './imports.constants';
import { ColumnMapping } from './imports.mapping';

@injectable()
export class ImportsRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  create(data: {
    tenantId: string;
    createdById: string;
    filename: string;
    originalName: string;
    mimeType: string;
    filePath: string;
    status: ImportStatus;
    idempotencyKey: string;
  }) {
    return this.prisma.import.create({ data });
  }

  findById(id: string, tenantId: string) {
    return this.prisma.import.findFirst({
      where: { id, tenantId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  findByIdempotencyKey(key: string) {
    return this.prisma.import.findUnique({ where: { idempotencyKey: key } });
  }

  listByTenant(tenantId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    return this.prisma.$transaction([
      this.prisma.import.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.import.count({ where: { tenantId } }),
    ]);
  }

  update(id: string, data: Prisma.ImportUpdateInput) {
    return this.prisma.import.update({ where: { id }, data });
  }

  saveMapping(id: string, mapping: ColumnMapping) {
    return this.prisma.import.update({
      where: { id },
      data: { columnMapping: mapping },
    });
  }

  findRows(
    importId: string,
    page: number,
    pageSize: number = DEFAULT_PAGE_SIZE,
    status?: ImportRowStatus,
  ) {
    const where: Prisma.ImportRowWhereInput = {
      importId,
      ...(status ? { status } : {}),
    };
    const skip = (page - 1) * pageSize;
    return this.prisma.$transaction([
      this.prisma.importRow.findMany({
        where,
        orderBy: { lineNumber: 'asc' },
        skip,
        take: pageSize,
      }),
      this.prisma.importRow.count({ where }),
    ]);
  }

  getClient() {
    return this.prisma;
  }
}
