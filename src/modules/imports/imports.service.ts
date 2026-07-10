import { inject, injectable } from 'tsyringe';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import {
  ActionPriority,
  ActionStatus,
  ImportStatus,
  Role,
} from '@prisma/client';
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
  ConfirmImportInput,
  REQUIRED_COLUMNS,
  SpreadsheetRow,
} from './imports.schemas';

const STATUS_MAP: Record<string, ActionStatus> = {
  pendente: ActionStatus.PENDING,
  pending: ActionStatus.PENDING,
  'em andamento': ActionStatus.IN_PROGRESS,
  'in_progress': ActionStatus.IN_PROGRESS,
  andamento: ActionStatus.IN_PROGRESS,
  concluido: ActionStatus.COMPLETED,
  concluído: ActionStatus.COMPLETED,
  completed: ActionStatus.COMPLETED,
  atrasado: ActionStatus.DELAYED,
  delayed: ActionStatus.DELAYED,
  cancelado: ActionStatus.CANCELED,
  canceled: ActionStatus.CANCELED,
};

const PRIORITY_MAP: Record<string, ActionPriority> = {
  baixa: ActionPriority.LOW,
  low: ActionPriority.LOW,
  media: ActionPriority.MEDIUM,
  média: ActionPriority.MEDIUM,
  medium: ActionPriority.MEDIUM,
  alta: ActionPriority.HIGH,
  high: ActionPriority.HIGH,
  critica: ActionPriority.CRITICAL,
  crítica: ActionPriority.CRITICAL,
  critical: ActionPriority.CRITICAL,
};

@injectable()
export class ImportsService {
  constructor(
    @inject(ImportsRepository) private readonly importsRepository: ImportsRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async upload(actor: AuthUser, file: Express.Multer.File) {
    this.assertCanImport(actor);

    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext) && !allowed.includes(file.mimetype)) {
      throw new ValidationError('Formato inválido. Envie xlsx ou csv.');
    }

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
        import: existing,
        preview: existing.previewData,
        errors: existing.errorReport,
        duplicated: true,
      };
    }

    const { rows, errors } = this.parseSpreadsheet(file.path);
    const preview = rows.slice(0, 50);

    const record = await this.importsRepository.create({
      tenantId: actor.tenantId,
      createdById: actor.id,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      status: ImportStatus.PREVIEW,
      totalRows: rows.length,
      previewData: { rows, preview },
      idempotencyKey,
      errorReport: errors,
      errorRows: errors.length,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'imports.upload',
      resource: 'import',
      resourceId: record.id,
      metadata: { totalRows: rows.length, errorRows: errors.length },
    });

    return {
      import: {
        id: record.id,
        status: record.status,
        totalRows: record.totalRows,
        errorRows: record.errorRows,
        originalName: record.originalName,
      },
      preview,
      errors,
      duplicated: false,
    };
  }

  async confirm(actor: AuthUser, input: ConfirmImportInput) {
    this.assertCanImport(actor);

    const record = await this.importsRepository.findById(input.importId, actor.tenantId);
    if (!record) throw new NotFoundError('Importação não encontrada');

    if (record.status === ImportStatus.COMPLETED || record.status === ImportStatus.PARTIAL) {
      return {
        id: record.id,
        status: record.status,
        successRows: record.successRows,
        errorRows: record.errorRows,
        alreadyProcessed: true,
      };
    }

    if (record.status !== ImportStatus.PREVIEW && record.status !== ImportStatus.PENDING) {
      throw new ValidationError('Importação não está pronta para confirmação');
    }

    await this.importsRepository.update(record.id, { status: ImportStatus.PROCESSING });

    const previewData = record.previewData as { rows: SpreadsheetRow[] };
    const rows = previewData?.rows ?? [];
    const prisma = this.importsRepository.getClient();

    const result = await prisma.$transaction(async (tx) => {
      let actionPlanId = input.actionPlanId;

      if (!actionPlanId) {
        const plan = await tx.actionPlan.create({
          data: {
            tenantId: actor.tenantId,
            ownerId: actor.id,
            title: input.actionPlanTitle ?? `Importação ${record.originalName}`,
          },
        });
        actionPlanId = plan.id;
      } else {
        const plan = await tx.actionPlan.findFirst({
          where: { id: actionPlanId, tenantId: actor.tenantId },
        });
        if (!plan) throw new NotFoundError('Plano de ação não encontrado');
      }

      const units = await tx.unit.findMany({ where: { tenantId: actor.tenantId } });
      const users = await tx.user.findMany({
        where: { memberships: { some: { tenantId: actor.tenantId } } },
      });

      const lineErrors: Array<{ line: number; message: string }> = [];
      let success = 0;

      for (const row of rows) {
        try {
          const status = STATUS_MAP[this.normalize(row.status)];
          const priority = PRIORITY_MAP[this.normalize(row.prioridade)];

          if (!row.titulo?.trim()) {
            lineErrors.push({ line: row.line, message: 'Título obrigatório' });
            continue;
          }
          if (!status) {
            lineErrors.push({ line: row.line, message: `Status inválido: ${row.status}` });
            continue;
          }
          if (!priority) {
            lineErrors.push({
              line: row.line,
              message: `Prioridade inválida: ${row.prioridade}`,
            });
            continue;
          }

          const unit = units.find(
            (u) => this.normalize(u.name) === this.normalize(row.unidade),
          );
          const responsible = users.find(
            (u) =>
              this.normalize(u.name) === this.normalize(row.responsavel) ||
              this.normalize(u.email) === this.normalize(row.responsavel),
          );

          const externalKey =
            row.chave?.trim() ||
            generateIdempotencyKey([
              actionPlanId!,
              row.titulo,
              row.responsavel,
              row.unidade,
              row.prazo ?? '',
            ]).slice(0, 32);

          await tx.actionPlanRow.upsert({
            where: {
              actionPlanId_externalKey: {
                actionPlanId: actionPlanId!,
                externalKey,
              },
            },
            update: {
              title: row.titulo.trim(),
              description: row.descricao?.trim(),
              status,
              priority,
              dueDate: row.prazo ? new Date(row.prazo) : null,
              unitId: unit?.id,
              responsibleId: responsible?.id,
              responsibleName: row.responsavel,
              unitName: row.unidade,
            },
            create: {
              actionPlanId: actionPlanId!,
              externalKey,
              title: row.titulo.trim(),
              description: row.descricao?.trim(),
              status,
              priority,
              dueDate: row.prazo ? new Date(row.prazo) : null,
              unitId: unit?.id,
              responsibleId: responsible?.id,
              responsibleName: row.responsavel,
              unitName: row.unidade,
            },
          });

          success += 1;
        } catch (error) {
          lineErrors.push({
            line: row.line,
            message: error instanceof Error ? error.message : 'Erro ao persistir linha',
          });
        }
      }

      const finalStatus =
        lineErrors.length === 0
          ? ImportStatus.COMPLETED
          : success > 0
            ? ImportStatus.PARTIAL
            : ImportStatus.FAILED;

      const updated = await tx.import.update({
        where: { id: record.id },
        data: {
          status: finalStatus,
          actionPlanId,
          successRows: success,
          errorRows: lineErrors.length,
          errorReport: lineErrors,
          confirmedAt: new Date(),
        },
      });

      return updated;
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'imports.confirm',
      resource: 'import',
      resourceId: result.id,
      metadata: {
        successRows: result.successRows,
        errorRows: result.errorRows,
        status: result.status,
      },
    });

    return {
      id: result.id,
      status: result.status,
      successRows: result.successRows,
      errorRows: result.errorRows,
      errorReport: result.errorReport,
      actionPlanId: result.actionPlanId,
      alreadyProcessed: false,
    };
  }

  async getStatus(actor: AuthUser, id: string) {
    const record = await this.importsRepository.findById(id, actor.tenantId);
    if (!record) throw new NotFoundError('Importação não encontrada');

    if (actor.role === Role.OPERACIONAL && record.createdById !== actor.id) {
      throw new ForbiddenError();
    }

    return {
      id: record.id,
      status: record.status,
      totalRows: record.totalRows,
      successRows: record.successRows,
      errorRows: record.errorRows,
      errorReport: record.errorReport,
      originalName: record.originalName,
      confirmedAt: record.confirmedAt,
      createdAt: record.createdAt,
    };
  }

  private parseSpreadsheet(filePath: string): {
    rows: SpreadsheetRow[];
    errors: Array<{ line: number; message: string }>;
  } {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new ValidationError('Planilha vazia');
    }

    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
    });

    if (raw.length === 0) {
      throw new ValidationError('Planilha sem dados');
    }

    const normalizedHeaders = Object.keys(raw[0]).map((h) => this.normalizeHeader(h));
    const missing = REQUIRED_COLUMNS.filter((col) => !normalizedHeaders.includes(col));
    if (missing.length > 0) {
      throw new ValidationError(`Colunas obrigatórias ausentes: ${missing.join(', ')}`);
    }

    const headerMap: Record<string, string> = {};
    for (const key of Object.keys(raw[0])) {
      headerMap[this.normalizeHeader(key)] = key;
    }

    const rows: SpreadsheetRow[] = [];
    const errors: Array<{ line: number; message: string }> = [];

    raw.forEach((item, index) => {
      const line = index + 2;
      const get = (col: string) => String(item[headerMap[col]] ?? '').trim();

      const row: SpreadsheetRow = {
        line,
        titulo: get('titulo'),
        descricao: get('descricao') || undefined,
        status: get('status'),
        prioridade: get('prioridade'),
        responsavel: get('responsavel'),
        unidade: get('unidade'),
        prazo: get('prazo') || undefined,
        chave: get('chave') || undefined,
      };

      if (!row.titulo) {
        errors.push({ line, message: 'Título vazio' });
      }
      if (!row.status) {
        errors.push({ line, message: 'Status vazio' });
      }
      if (!row.prioridade) {
        errors.push({ line, message: 'Prioridade vazia' });
      }

      rows.push(row);
    });

    return { rows, errors };
  }

  private normalizeHeader(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '')
      .replace(/_/g, '');
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private assertCanImport(actor: AuthUser) {
    if (actor.role === Role.OPERACIONAL) {
      throw new ForbiddenError('Operacional não importa planilhas');
    }
  }

  ensureUploadDir() {
    const dir = path.resolve(process.cwd(), env.UPLOAD_DIR);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }
}
