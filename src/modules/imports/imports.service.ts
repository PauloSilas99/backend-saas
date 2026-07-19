import { inject, injectable } from 'tsyringe';
import fs from 'fs';
import path from 'path';
import { ImportRowStatus, ImportStatus } from '@prisma/client';
import {
  canImportSpreadsheet,
  isOperacional,
  isPlatformAdmin,
} from '@shared/helpers/rbac';
import { env } from '@config/env';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@shared/errors/AppError';
import { generateIdempotencyKey } from '@shared/helpers/crypto';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import { ImportsRepository } from './imports.repository';
import {
  ColumnMappingInput,
  ConfirmImportInput,
  ListImportsQuery,
  PreviewQuery,
} from './imports.schemas';
import {
  assertAllowedExtension,
  assertAllowedUploadMime,
  assertRealFileType,
} from './imports.file-validator';
import {
  suggestColumnMapping,
  SYSTEM_FIELDS,
  validateMappingCompleteness,
  ColumnMapping,
} from './imports.mapping';
import {
  enqueueCommitJob,
  enqueueParseJob,
  enqueueValidateJob,
} from './imports.queue';

@injectable()
export class ImportsService {
  constructor(
    @inject(ImportsRepository) private readonly importsRepository: ImportsRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async upload(actor: AuthUser, file: Express.Multer.File) {
    this.assertCanImport(actor);

    assertAllowedExtension(file.originalname);
    assertAllowedUploadMime(file.mimetype);

    const realMime = await assertRealFileType(file.path, file.originalname);

    const fileBuffer = fs.readFileSync(file.path);
    const idempotencyKey = generateIdempotencyKey([
      actor.tenantId,
      file.originalname,
      String(file.size),
      fileBuffer.toString('base64').slice(0, 64),
    ]);

    const existing = await this.importsRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        jobId: existing.id,
        status: existing.status,
        duplicated: true,
      };
    }

    const storedPath = path.resolve(process.cwd(), env.UPLOAD_DIR, file.filename);

    const record = await this.importsRepository.create({
      tenantId: actor.tenantId,
      createdById: actor.id,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: realMime,
      filePath: storedPath,
      status: ImportStatus.PENDING,
      idempotencyKey,
    });

    await enqueueParseJob({ importJobId: record.id, tenantId: actor.tenantId });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'imports.upload',
      resource: 'import',
      resourceId: record.id,
      metadata: { originalName: file.originalname },
    });

    return {
      jobId: record.id,
      status: record.status,
      duplicated: false,
    };
  }

  async list(actor: AuthUser, query: ListImportsQuery) {
    this.assertCanImport(actor);
    const [items, total] = await this.importsRepository.listByTenant(
      actor.tenantId,
      query.page,
      query.pageSize,
    );

    return {
      items: items.map((item) => ({
        id: item.id,
        status: item.status,
        originalName: item.originalName,
        totalRows: item.totalRows,
        successRows: item.successRows,
        errorRows: item.errorRows,
        warningRows: item.warningRows,
        createdAt: item.createdAt,
        confirmedAt: item.confirmedAt,
        createdBy: item.createdBy,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async getById(actor: AuthUser, jobId: string) {
    const record = await this.assertJobAccess(actor, jobId);

    return {
      id: record.id,
      status: record.status,
      statusMessage: record.statusMessage,
      originalName: record.originalName,
      mimeType: record.mimeType,
      fileUrl: this.buildFileUrl(record.filename),
      filePath: record.filePath,
      totalRows: record.totalRows,
      successRows: record.successRows,
      errorRows: record.errorRows,
      warningRows: record.warningRows,
      headers: record.headers,
      columnMapping: record.columnMapping,
      actionPlanId: record.actionPlanId,
      confirmedAt: record.confirmedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      createdBy: record.createdBy,
    };
  }

  async getColumns(actor: AuthUser, jobId: string) {
    const record = await this.assertJobAccess(actor, jobId);

    if (
      record.status !== ImportStatus.READY_FOR_MAPPING &&
      record.status !== ImportStatus.READY_FOR_PREVIEW &&
      record.status !== ImportStatus.PREVIEW &&
      record.status !== ImportStatus.PROCESSING_COMMIT &&
      record.status !== ImportStatus.COMPLETED &&
      record.status !== ImportStatus.PARTIAL &&
      record.status !== ImportStatus.FAILED
    ) {
      throw new ValidationError('Importação ainda não está pronta para mapeamento');
    }

    const headers = (record.headers as string[] | null) ?? [];
    const suggestedMapping = suggestColumnMapping(headers);

    return {
      headers,
      systemFields: SYSTEM_FIELDS,
      suggestedMapping,
      currentMapping: (record.columnMapping as ColumnMapping | null) ?? null,
    };
  }

  async saveMapping(actor: AuthUser, jobId: string, input: ColumnMappingInput) {
    this.assertCanImport(actor);
    const record = await this.assertJobAccess(actor, jobId);

    if (record.status !== ImportStatus.READY_FOR_MAPPING) {
      throw new ValidationError('Importação não está no status ready_for_mapping');
    }

    const missing = validateMappingCompleteness(input.mapping);
    if (missing.length > 0) {
      throw new ValidationError(
        `Campos obrigatórios não mapeados: ${missing.join(', ')}`,
      );
    }

    await this.importsRepository.saveMapping(jobId, input.mapping);
    await this.importsRepository.update(jobId, { status: ImportStatus.PROCESSING });
    await enqueueValidateJob({ importJobId: jobId, tenantId: actor.tenantId });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'imports.mapping',
      resource: 'import',
      resourceId: jobId,
      metadata: { mapping: input.mapping },
    });

    return { jobId, status: ImportStatus.PROCESSING };
  }

  async getPreview(actor: AuthUser, jobId: string, query: PreviewQuery) {
    const record = await this.assertJobAccess(actor, jobId);

    if (
      record.status !== ImportStatus.READY_FOR_PREVIEW &&
      record.status !== ImportStatus.PREVIEW &&
      record.status !== ImportStatus.PROCESSING_COMMIT &&
      record.status !== ImportStatus.COMPLETED &&
      record.status !== ImportStatus.PARTIAL
    ) {
      throw new ValidationError('Preview indisponível para o status atual');
    }

    const statusFilter = query.status as ImportRowStatus | undefined;
    const [rows, total] = await this.importsRepository.findRows(
      jobId,
      query.page,
      query.pageSize,
      statusFilter,
    );

    return {
      jobId,
      status: record.status,
      summary: {
        totalRows: record.totalRows,
        errorRows: record.errorRows,
        warningRows: record.warningRows,
      },
      items: rows.map((row) => ({
        lineNumber: row.lineNumber,
        rawData: row.rawData,
        mappedData: row.mappedData,
        status: row.status,
        messages: row.messages,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async confirm(actor: AuthUser, jobId: string, input: ConfirmImportInput) {
    this.assertCanImport(actor);
    const record = await this.assertJobAccess(actor, jobId);

    if (record.status === ImportStatus.COMPLETED || record.status === ImportStatus.PARTIAL) {
      return {
        jobId: record.id,
        status: record.status,
        successRows: record.successRows,
        errorRows: record.errorRows,
        actionPlanId: record.actionPlanId,
        alreadyProcessed: true,
      };
    }

    if (
      record.status !== ImportStatus.READY_FOR_PREVIEW &&
      record.status !== ImportStatus.PREVIEW
    ) {
      throw new ValidationError('Importação não está pronta para confirmação');
    }

    await this.importsRepository.update(jobId, { status: ImportStatus.PROCESSING_COMMIT });
    await enqueueCommitJob({
      importJobId: jobId,
      tenantId: actor.tenantId,
      userId: actor.id,
      actionPlanId: input.actionPlanId,
      actionPlanTitle: input.actionPlanTitle,
    });

    return {
      jobId,
      status: ImportStatus.PROCESSING_COMMIT,
      message: 'Confirmação enfileirada para processamento assíncrono',
      alreadyProcessed: false,
    };
  }

  /** Compatibilidade com rota legada GET /:id/status */
  async getStatus(actor: AuthUser, id: string) {
    const data = await this.getById(actor, id);
    return {
      id: data.id,
      status: data.status,
      totalRows: data.totalRows,
      successRows: data.successRows,
      errorRows: data.errorRows,
      originalName: data.originalName,
      confirmedAt: data.confirmedAt,
      createdAt: data.createdAt,
    };
  }

  ensureUploadDir() {
    const dir = path.resolve(process.cwd(), env.UPLOAD_DIR);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private async assertJobAccess(actor: AuthUser, jobId: string) {
    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError(
        'Admin da plataforma não acessa importações das empresas',
      );
    }

    const record = await this.importsRepository.findById(jobId, actor.tenantId);
    if (!record) {
      throw new NotFoundError('Importação não encontrada');
    }

    if (isOperacional(actor)) {
      throw new ForbiddenError();
    }

    return record;
  }

  private buildFileUrl(filename: string) {
    return `/uploads/${filename}`;
  }

  private assertCanImport(actor: AuthUser) {
    if (isPlatformAdmin(actor) || !canImportSpreadsheet(actor)) {
      throw new ForbiddenError('Sem permissão para importar planilhas');
    }
  }
}
