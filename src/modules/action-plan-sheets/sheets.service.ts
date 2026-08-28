import { inject, injectable } from 'tsyringe';
import fs from 'fs';
import {
  ActionPriority,
  ActionStatus,
  ColumnFieldType,
  ColumnHistoryAction,
  ColumnSemanticRole,
} from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError, QuotaError, ValidationError } from '@shared/errors/AppError';
import { AuthUser } from '@/types/auth';
import {
  canCreateActions,
  canImportSpreadsheet,
  canManageColumns,
  isOperacional,
  isPlatformAdmin,
} from '@shared/helpers/rbac';
import { isBlankPlanRow } from '@shared/helpers/plan-row-blank';
import { ActionPlansRepository } from '@modules/action-plans/action-plans.repository';
import { assignCanonicalKeys, pickCanonicalKey } from '@modules/columns/canonical-backfill';
import { parseDateOnly } from '@modules/action-plans/project-row';
import { buildHeaderReport, missingRowKeys, validateRowValues } from './import-report';
import { CompaniesRepository } from '@modules/companies/companies.repository';
import {
  buildWorkbook,
  rowsToWorkbookRows,
  workbookFileName,
} from './workbook-writer';
import { ActionPlansService } from '@modules/action-plans/action-plans.service';
import { ColumnsRepository } from '@modules/columns/columns.repository';
import { CreateColumnInput, UpdateColumnInput } from '@modules/columns/columns.schemas';
import { inferSemanticRole, pickUniqueSemanticRoles } from '@modules/columns/column-semantics';
import {
  BulkSheetInput,
  ChartSeriesInput,
  ColumnsOrderInput,
  ImportFromParseInput,
  ImportSheetJsonInput,
  SaveMyChartsInput,
} from '@modules/action-plans/action-plans.schemas';
import { normalizeDateValue, padRow } from './parse/sheet-cells';
import { headersFromRow } from './parse/spreadsheet';
import { parseDueDateString, pickDueDateFromNamedValues } from './parse/due-date';
import { assertAllowedExtension, assertRealFileType } from './parse/file-validator';
import {
  deleteSheetParse,
  hasPhysicalStaging,
  iteratePhysicalParseRows,
  iterateSheetParseRows,
  loadSheetParseMeta,
  PARSE_SAMPLE_ROWS,
  readSheetParseDistincts,
  readSheetParseSample,
  resolveSheetParseSourcePath,
  saveSheetParseFromFile,
  streamSheetParseSource,
} from './sheet-parse.store';
import {
  enqueueSheetImportJob,
  enqueueSheetParseJob,
  getSheetJob,
  toParseJobResult,
  type SheetImportIssue,
  type SheetImportJobResult,
  type SheetJob,
  type SheetJobProgress,
} from './sheet-import.jobs';
import {
  SHEET_META_CACHE_TTL_SEC,
  acquireExclusiveLock,
  cacheGet,
  cacheGetJson,
  cacheSet,
  cacheSetJson,
  cacheUnlock,
  invalidateSheetCaches,
  sheetAnalyticsCacheKey,
  sheetJobLockKey,
  sheetMetaCacheKey,
  sheetRowCountCacheKey,
} from '@config/redis-cache';
import { TenantQuotaService } from '@shared/limits/tenant-quota.service';
import {
  PRODUCT_LIMITS,
  columnQuotaMessage,
  importJobInProgressMessage,
  importTruncatedMessage,
  rowQuotaMessage,
  uploadQuotaMessage,
} from '@shared/limits/product-limits';
import type { SheetAnalyticsResult } from '@modules/action-plans/workbook-analytics';
import {
  chartsForSheet,
  chartsForSheetWithDefaults,
  mergeSheetCharts,
  removeSheetCharts,
  sanitizeUserCharts,
  type UserChartSlice,
  type UserChartSpec,
} from './user-charts';

const IMPORT_FROM_PARSE_BATCH = 500;
const IMPORT_ISSUE_CAP = 100;
const SUMMARY_PAGE_SIZE = 50;

const STATUS_MAP: Record<string, ActionStatus> = {
  pending: ActionStatus.PENDING,
  pendente: ActionStatus.PENDING,
  in_progress: ActionStatus.IN_PROGRESS,
  'em andamento': ActionStatus.IN_PROGRESS,
  completed: ActionStatus.COMPLETED,
  concluido: ActionStatus.COMPLETED,
  delayed: ActionStatus.DELAYED,
  atrasado: ActionStatus.DELAYED,
  'no prazo': ActionStatus.PENDING,
  'sem prazo': ActionStatus.PENDING,
  'em atraso': ActionStatus.DELAYED,
  'concluído': ActionStatus.COMPLETED,
  cancelado: ActionStatus.CANCELED,
  cancelada: ActionStatus.CANCELED,
  canceled: ActionStatus.CANCELED,
};

const PRIORITY_MAP: Record<string, ActionPriority> = {
  low: ActionPriority.LOW,
  baixa: ActionPriority.LOW,
  medium: ActionPriority.MEDIUM,
  media: ActionPriority.MEDIUM,
  high: ActionPriority.HIGH,
  alta: ActionPriority.HIGH,
  critical: ActionPriority.CRITICAL,
  critica: ActionPriority.CRITICAL,
};

type PlanMeta = Awaited<ReturnType<ActionPlansRepository['findPlanMeta']>>;
type SerializedPlanMeta = Omit<NonNullable<PlanMeta>, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

function revivePlanMeta(raw: SerializedPlanMeta): NonNullable<PlanMeta> {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
}

@injectable()
export class SheetsService {
  constructor(
    @inject(ActionPlansRepository) private readonly plansRepo: ActionPlansRepository,
    @inject(ActionPlansService) private readonly plansService: ActionPlansService,
    @inject(ColumnsRepository) private readonly columnsRepo: ColumnsRepository,
    @inject(TenantQuotaService) private readonly tenantQuota: TenantQuotaService,
    @inject(CompaniesRepository) private readonly companiesRepo: CompaniesRepository,
  ) {}

  async buildTemplate(actor: AuthUser): Promise<{ buffer: Buffer; fileName: string }> {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const empresaNome = await this.empresaNome(actor.tenantId);
    return {
      buffer: await buildWorkbook({ empresaNome }),
      fileName: workbookFileName(empresaNome, new Date()),
    };
  }

  async exportSheet(
    actor: AuthUser,
    sheetId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    await this.assertSheet(actor, sheetId);
    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;

    const [columns, rows, empresaNome] = await Promise.all([
      this.columnsRepo.listActive(sheetId),
      this.plansRepo.listRowsForExport(sheetId, actor.tenantId, scopeResponsibleId),
      this.empresaNome(actor.tenantId),
    ]);

    const workbookRows = rowsToWorkbookRows(
      rows.map((row) => ({
        externalKey: row.externalKey,
        cells: (row.cells ?? {}) as Record<string, unknown>,
      })),
      columns,
    );

    return {
      buffer: await buildWorkbook({ empresaNome, rows: workbookRows }),
      fileName: workbookFileName(empresaNome, new Date()),
    };
  }

  private async empresaNome(tenantId: string): Promise<string> {
    const empresa = await this.companiesRepo.findById(tenantId);
    return empresa?.name?.trim() || 'empresa';
  }

  async list(actor: AuthUser) {
    return this.plansService.listPlans(actor);
  }

  async getById(actor: AuthUser, id: string) {
    return this.getSummary(actor, id);
  }

  /**
   * Meta + colunas + rowCount — sem carregar as linhas (planilhas grandes).
   */
  async getSummary(actor: AuthUser, id: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const plan = await this.getCachedPlanMeta(actor.tenantId, id);
    if (!plan) throw new NotFoundError('Planilha não encontrada');
    const columns = await this.columnsRepo.listActive(id);
    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;
    const rowCount = await this.getCachedRowCount(actor.tenantId, id, scopeResponsibleId);

    const rows =
      rowCount > 0
        ? (
            await this.plansRepo.listPlanRows(
              id,
              actor.tenantId,
              { page: 1, pageSize: SUMMARY_PAGE_SIZE },
              scopeResponsibleId,
            )
          ).items
        : [];

    return {
      ...plan,
      columns,
      rowCount,
      rows,
      rowsPageSize: SUMMARY_PAGE_SIZE,
    };
  }

  /** Somente leitura — não cria plano vazio (importação/criação explícita). */
  async getPrimaryForEmpresa(actor: AuthUser, empresaId?: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const tenantId = empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    const plan = await this.plansRepo.findPrimaryPlan(tenantId);
    if (!plan) {
      throw new NotFoundError('Nenhum plano de ação encontrado para esta empresa.');
    }
    return this.getSummary(actor, plan.id);
  }

  async deleteBlankRows(actor: AuthUser, sheetId: string) {
    await this.assertSheet(actor, sheetId);
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();

    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;
    const deleted = await this.plansRepo.softDeleteBlankRows(
      sheetId,
      actor.tenantId,
      scopeResponsibleId,
    );
    await invalidateSheetCaches(actor.tenantId, sheetId);
    return { deleted };
  }

  async listRows(
    actor: AuthUser,
    sheetId: string,
    query: { page: number; pageSize: number; search?: string },
  ) {
    await this.assertSheet(actor, sheetId);
    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;
    const { items, total } = await this.plansRepo.listPlanRows(
      sheetId,
      actor.tenantId,
      query,
      scopeResponsibleId,
    );
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
      },
    };
  }

  async createColumn(actor: AuthUser, sheetId: string, input: CreateColumnInput) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    await this.tenantQuota.assertCanAddColumns(sheetId, 1);
    const taken = await this.columnsRepo.takenCanonicalKeys(sheetId);
    const column = await this.columnsRepo.create(actor.tenantId, sheetId, {
      ...input,
      canonicalKey: pickCanonicalKey(input.label, taken),
    });
    await this.columnsRepo.addHistory({
      columnId: column.id,
      actorId: actor.id,
      action: ColumnHistoryAction.CREATED,
      snapshot: column,
    });
    return column;
  }

  async updateColumn(
    actor: AuthUser,
    sheetId: string,
    columnId: string,
    input: UpdateColumnInput,
  ) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const existing = await this.columnsRepo.findById(columnId, actor.tenantId, sheetId);
    if (!existing || existing.deletedAt) throw new NotFoundError('Coluna não encontrada');
    return this.columnsRepo.update(columnId, input);
  }

  async deleteColumn(actor: AuthUser, sheetId: string, columnId: string) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const deleted = await this.columnsRepo.softDelete(columnId, actor.id);
    await this.columnsRepo.stripCellKey(sheetId, columnId);
    return deleted;
  }

  async orderColumns(actor: AuthUser, sheetId: string, input: ColumnsOrderInput) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    await Promise.all(
      input.order.map((id, index) => this.columnsRepo.update(id, { sortOrder: index })),
    );
    return this.columnsRepo.listActive(sheetId);
  }

  async resetColumns(actor: AuthUser, sheetId: string) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const columns = await this.columnsRepo.listActive(sheetId);
    for (const col of columns) {
      await this.columnsRepo.softDelete(col.id, actor.id, 'reset');
      await this.columnsRepo.stripCellKey(sheetId, col.id);
    }
    return { reset: columns.length };
  }

  async resolveRow(
    actor: AuthUser,
    sheetId: string,
    rowId: string,
    input: { evidence?: string; completedAt?: string; comment?: string },
  ) {
    await this.assertSheet(actor, sheetId);
    return this.plansService.resolve(actor, rowId, input);
  }

  async bulkSave(actor: AuthUser, sheetId: string, input: BulkSheetInput) {
    const plan = await this.assertSheet(actor, sheetId);
    if (!canCreateActions(actor) && !canManageColumns(actor)) {
      throw new ForbiddenError();
    }

    if (input.title) {
      await this.plansRepo.updatePlan(plan.id, { title: input.title });
    }

    if (input.columns && canManageColumns(actor)) {
      const takenKeys = await this.columnsRepo.takenCanonicalKeys(plan.id);
      for (const [index, col] of input.columns.entries()) {
        const name = col.name
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, '_')
          .replace(/^[^a-z]/, 'c_')
          .slice(0, 60);
        const existing = col.id
          ? await this.columnsRepo.findById(col.id, actor.tenantId, sheetId)
          : null;
        if (existing && !existing.deletedAt) {
          await this.columnsRepo.update(col.id!, {
            label: col.label,
            fieldType: col.fieldType,
            required: col.required,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } else if (existing) {
          await this.columnsRepo.update(col.id!, {
            deletedAt: null,
            isActive: true,
            label: col.label,
            fieldType: col.fieldType,
            required: col.required,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } else {
          try {
            await this.columnsRepo.create(actor.tenantId, sheetId, {
              name,
              label: col.label,
              canonicalKey: pickCanonicalKey(col.label, takenKeys),
              fieldType: col.fieldType ?? ColumnFieldType.TEXT,
              required: col.required ?? false,
              options: col.options,
              sortOrder: col.sortOrder ?? index,
            });
          } catch {
            // ignore duplicates on autosave
          }
        }
      }
    }

    if (input.rows && canCreateActions(actor)) {
      await this.plansRepo.bulkUpsertSheetRows(actor.tenantId, sheetId, input.rows);
    }

    await invalidateSheetCaches(actor.tenantId, sheetId);
    return this.getSummary(actor, sheetId);
  }

  async importJson(actor: AuthUser, input: ImportSheetJsonInput) {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();

    const tenantId = input.empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    const issues: SheetImportIssue[] = [];
    let imported = 0;
    let skipped = 0;
    let quotaReached = false;

    let plan =
      (input.options?.planId
        ? await this.plansRepo.findPlanMeta(input.options.planId, tenantId)
        : null) ?? (await this.plansRepo.findPrimaryPlan(tenantId));

    if (input.options?.planId && !plan) {
      throw new NotFoundError('Plano de ação não encontrado para continuar a importação');
    }

    if (!plan || (input.options?.replaceExisting === false && !input.options?.planId)) {
      plan = await this.plansRepo.createPlan({
        tenantId,
        ownerId: actor.id,
        title: input.title,
      });
    } else if (!input.options?.planId) {
      await this.plansRepo.updatePlan(plan.id, { title: input.title });
    }

    if (
      input.options?.replaceExisting &&
      !input.options?.skipColumnSync &&
      !input.options?.upsertByExternalKey
    ) {
      await this.plansRepo.replaceWorkbookContent(plan.id, tenantId);
    }

    const columnInput = input.columns.slice(0, PRODUCT_LIMITS.maxColumnsPerSheet);
    if (input.columns.length > PRODUCT_LIMITS.maxColumnsPerSheet) {
      issues.push({ code: 'COLUMN_QUOTA', message: columnQuotaMessage() });
    }

    if (!input.options?.skipColumnSync) {
      const withRoles = pickUniqueSemanticRoles(
        columnInput.map((col, index) => ({
          ...col,
          semanticRole: inferSemanticRole({
            name: col.name,
            label: col.label,
            fieldType: col.fieldType,
          }),
          sortOrder: col.sortOrder ?? index,
        })),
      );
      const importTakenKeys = await this.columnsRepo.takenCanonicalKeys(plan.id);
      for (const [index, col] of withRoles.entries()) {
        const name = col.name
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, '_')
          .replace(/^[^a-z]/, 'c_')
          .slice(0, 60);
        try {
          await this.columnsRepo.create(tenantId, plan.id, {
            name,
            label: col.label,
            canonicalKey: pickCanonicalKey(col.label, importTakenKeys),
            fieldType: col.fieldType ?? ColumnFieldType.TEXT,
            semanticRole: col.semanticRole,
            required: col.required ?? false,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } catch {
          // column may already exist
        }
      }
    }

    const columns = await this.columnsRepo.listActive(plan.id);
    const columnByKey = new Map<string, (typeof columns)[number]>();
    for (const col of columns) {
      columnByKey.set(col.id, col);
      columnByKey.set(col.name, col);
    }
    const dueColumn = columns.find((c) => c.semanticRole === ColumnSemanticRole.DUE_DATE);
    const assigneeColumn = columns.find((c) => c.semanticRole === ColumnSemanticRole.ASSIGNEE);
    const members = await this.plansRepo.listTenantMembers(tenantId);

    type PreparedRow = {
      line: number;
      title: string;
      externalKey?: string;
      description?: string;
      status: ActionStatus;
      priority: ActionPriority;
      dueDate?: Date;
      responsibleId?: string;
      responsibleName?: string;
      unitId?: string;
      values: Record<string, unknown>;
    };

    const prepared: PreparedRow[] = [];

    for (const [index, row] of input.rows.entries()) {
      const line = index + 1;
      if (!row.title?.trim()) {
        skipped += 1;
        issues.push({ line, code: 'ROW_ERROR', message: 'Título vazio' });
        continue;
      }

      const status = row.status
        ? STATUS_MAP[row.status.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')]
        : ActionStatus.PENDING;
      const priority = row.priority
        ? PRIORITY_MAP[
            row.priority.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          ]
        : ActionPriority.MEDIUM;

      if (row.status && !status) {
        skipped += 1;
        issues.push({ line, code: 'ROW_ERROR', message: `Status inválido: ${row.status}` });
        continue;
      }

      const values = (row.values ?? {}) as Record<string, unknown>;
      const stringValues = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value ?? '').trim()]),
      ) as Record<string, string>;
      const dueRaw =
        row.dueDate?.trim() ||
        (dueColumn ? String(values[dueColumn.name] ?? values[dueColumn.id] ?? '') : '');
      const dueDate =
        parseDueDateString(dueRaw) ?? pickDueDateFromNamedValues(stringValues);

      const assigneeRaw =
        (assigneeColumn
          ? String(values[assigneeColumn.name] ?? values[assigneeColumn.id] ?? '')
          : '') || '';
      const matched = matchTenantMember(members, assigneeRaw);

      if (
        isBlankPlanRow({
          title: row.title,
          description: row.description,
          responsibleName: assigneeRaw.trim() || matched?.name,
          unitName: undefined,
          dueDate: dueDate ?? null,
          fieldValues: Object.entries(stringValues).map(([name, value]) => ({
            value,
            column: { name },
          })),
        })
      ) {
        skipped += 1;
        continue;
      }

      prepared.push({
        line,
        title: row.title,
        externalKey: row.externalKey?.trim() || undefined,
        description: row.description,
        status: status ?? ActionStatus.PENDING,
        priority: priority ?? ActionPriority.MEDIUM,
        dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : undefined,
        responsibleId: row.responsibleId ?? matched?.id,
        responsibleName: assigneeRaw.trim() || matched?.name,
        unitId: row.unitId,
        values,
      });
    }

    const remaining = await this.tenantQuota.remainingRows(tenantId);
    if (remaining <= 0) {
      throw new QuotaError(rowQuotaMessage(), {
        limit: PRODUCT_LIMITS.maxRowsPerTenant,
      });
    }
    if (prepared.length > remaining) {
      skipped += prepared.length - remaining;
      quotaReached = true;
      issues.push({ code: 'QUOTA_EXCEEDED', message: rowQuotaMessage() });
      prepared.length = remaining;
    }

    const BATCH = 100;
    for (let offset = 0; offset < prepared.length; offset += BATCH) {
      const slice = prepared.slice(offset, offset + BATCH);
      try {
        const created = await this.plansRepo.commitImportChunk({
          tenantId,
          actionPlanId: plan.id,
          rows: slice.map((row) => ({
            actionPlanId: plan.id,
            externalKey: row.externalKey,
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            dueDate: row.dueDate,
            responsibleId: row.responsibleId,
            responsibleName: row.responsibleName,
            unitId: row.unitId,
          })),
          values: slice.map((row) => row.values),
          columnByKey,
          actorId: actor.id,
        });
        imported += created.length;
      } catch (error) {
        // Fallback: tenta linha a linha neste lote para não perder o restante
        for (const row of slice) {
          try {
            await this.plansService.addRow(actor, plan.id, {
              title: row.title,
              description: row.description,
              status: row.status,
              priority: row.priority,
              dueDate: row.dueDate?.toISOString(),
              responsibleId: row.responsibleId,
              unitId: row.unitId,
              values: row.values as Record<string, string | number | boolean | null>,
            });
            imported += 1;
          } catch (rowError) {
            skipped += 1;
            issues.push({
              line: row.line,
              code: 'ROW_ERROR',
              message:
                rowError instanceof Error ? rowError.message : 'Erro ao importar linha',
            });
          }
        }
        void error;
      }
    }

    await invalidateSheetCaches(tenantId, plan.id);
    return {
      planId: plan.id,
      imported,
      skipped,
      truncated: quotaReached,
      quotaReached,
      issues,
    };
  }

  /**
   * Recebe o arquivo, devolve jobId na hora e extrai células em background (JSONL).
   */
  async enqueueParseUpload(
    actor: AuthUser,
    file: Express.Multer.File,
  ): Promise<{ jobId: string }> {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    if (!file?.path) {
      throw new NotFoundError('Arquivo não recebido');
    }
    if (file.size > PRODUCT_LIMITS.maxUploadMb * 1024 * 1024) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
      throw new QuotaError(uploadQuotaMessage());
    }

    try {
      assertAllowedExtension(file.originalname);
      await assertRealFileType(file.path, file.originalname);
    } catch (err) {
      try {
        fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
      throw err;
    }

    const jobId = await enqueueSheetParseJob({
      tenantId: actor.tenantId,
      actor,
      filePath: file.path,
      originalName: file.originalname,
    });
    return { jobId };
  }

  async getJob(actor: AuthUser, jobId: string): Promise<SheetJob> {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const job = await getSheetJob(actor.tenantId, jobId);
    if (job.actorId !== actor.id) {
      throw new NotFoundError('Processamento não encontrado.');
    }
    return job;
  }

  async getParseDistincts(actor: AuthUser, parseId: string, header: string) {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const values = await readSheetParseDistincts(actor.tenantId, parseId, header);
    return { header, values };
  }

  async enqueueImportFromParse(
    actor: AuthUser,
    input: ImportFromParseInput,
  ): Promise<{ jobId: string }> {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();

    const tenantId = input.empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    await loadSheetParseMeta(actor.tenantId, input.parseId);

    const jobId = await enqueueSheetImportJob({
      tenantId: actor.tenantId,
      actor,
      input,
    });
    return { jobId };
  }

  async executeParseJob(
    actor: AuthUser,
    file: { path: string; originalname: string },
    onProgress?: (progress: SheetJobProgress) => void | Promise<void>,
  ) {
    const lockKey = sheetJobLockKey(actor.tenantId);
    const locked = await acquireExclusiveLock(lockKey, 15 * 60);
    if (!locked) {
      throw new ConflictError(importJobInProgressMessage(), 'JOB_IN_PROGRESS');
    }

    try {
      await onProgress?.({ current: 0, total: 0, phase: 'parse' });

      const stored = await saveSheetParseFromFile({
        tenantId: actor.tenantId,
        fileName: file.originalname,
        filePath: file.path,
        onProgress: (rows) => {
          void onProgress?.({ current: rows, total: rows, phase: 'parse' });
        },
      });

      const sampleRows = await readSheetParseSample(
        actor.tenantId,
        stored.parseId,
        PARSE_SAMPLE_ROWS,
      );

      await onProgress?.({
        current: stored.totalRows,
        total: stored.totalRows,
        phase: 'parse',
      });
      return toParseJobResult(stored, sampleRows);
    } finally {
      await cacheUnlock(lockKey);
      try {
        if (file.path) fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
    }
  }

  async executeImportJob(
    actor: AuthUser,
    input: ImportFromParseInput,
    onProgress?: (progress: SheetJobProgress) => void | Promise<void>,
  ) {
    const lockKey = sheetJobLockKey(actor.tenantId);
    const locked = await acquireExclusiveLock(lockKey, 30 * 60);
    if (!locked) {
      throw new ConflictError(importJobInProgressMessage(), 'JOB_IN_PROGRESS');
    }

    try {
      await onProgress?.({ current: 0, total: 0, phase: 'import' });
      const result = await this.importFromParse(actor, input, (current, total) => {
        void onProgress?.({ current, total, phase: 'import' });
      });
      if (result.planId) {
        await invalidateSheetCaches(actor.tenantId, result.planId);
      }
      await onProgress?.({
        current: result.imported + result.skipped,
        total: result.imported + result.skipped,
        phase: 'import',
      });
      return result;
    } finally {
      await cacheUnlock(lockKey);
    }
  }

  async importFromParse(
    actor: AuthUser,
    input: ImportFromParseInput,
    onProgress?: (current: number, total: number) => void,
  ): Promise<SheetImportJobResult> {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();

    const tenantId = input.empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    const meta = await loadSheetParseMeta(actor.tenantId, input.parseId);
    const headerRowIndex = input.headerRowIndex ?? meta.suggestedHeaderRow ?? 1;
    onProgress?.(0, meta.totalRows);

    const columns = input.columns.slice(0, PRODUCT_LIMITS.maxColumnsPerSheet).map((col, index) => ({
      name: col.name
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^[^a-z]/, 'c_')
        .slice(0, 60),
      label: col.label,
      fieldType: col.fieldType ?? ColumnFieldType.TEXT,
      required: col.required ?? false,
      options: col.options,
      sortOrder: col.sortOrder ?? index,
      sourceHeader: col.sourceHeader,
      sourceColIndex: col.sourceColIndex,
    }));

    const nameByCanonical = new Map<string, string>();
    for (const assignment of assignCanonicalKeys(
      columns.map((col, index) => ({
        id: col.name,
        label: col.label,
        sortOrder: col.sortOrder ?? index,
      })),
    )) {
      if (assignment.canonicalKey) nameByCanonical.set(assignment.canonicalKey, assignment.id);
    }

    const headerReport = buildHeaderReport(columns.map((col) => col.sourceHeader || col.label));
    const seenExternalKeys = new Set<string>();
    const targetPlan = await this.plansRepo.findPrimaryPlan(tenantId);
    const keysBeforeImport = targetPlan
      ? await this.plansRepo.listExternalKeys(targetPlan.id)
      : [];

    let planId: string | undefined;
    let imported = 0;
    let skipped = 0;
    const issues: SheetImportIssue[] = [];
    let globalLine = 0;
    let firstChunk = true;
    let quotaReached = false;
    let fileTruncated = false;
    let headerIndexByName = new Map<string, number>();

    if (input.columns.length > PRODUCT_LIMITS.maxColumnsPerSheet) {
      issues.push({ code: 'COLUMN_QUOTA', message: columnQuotaMessage() });
    }

    const mapValues = (dense: string[], rawByHeader?: Record<string, string>) => {
      const values: Record<string, string> = {};
      for (const col of columns) {
        const fromIndex =
          col.sourceColIndex >= 0 ? dense[col.sourceColIndex] : undefined;
        const fallbackIndex = headerIndexByName.get(col.sourceHeader);
        const fromHeaderIndex =
          fallbackIndex != null ? dense[fallbackIndex] : undefined;
        let value =
          fromIndex ?? fromHeaderIndex ?? rawByHeader?.[col.sourceHeader] ?? '';
        if (col.fieldType === ColumnFieldType.DATE && value.trim()) {
          value = normalizeDateValue(value).value;
        }
        values[col.name] = value;
      }
      return values;
    };

    const toImportRow = (values: Record<string, string>, line: number) => {
      const canonical = (key: string): string | undefined => {
        const name = nameByCanonical.get(key);
        if (!name) return undefined;
        return values[name]?.trim() || undefined;
      };

      const title =
        canonical('acoes') ??
        pickMappedValue(values, [
          'title',
          'titulo',
          'acao_corretiva',
          'plano_risco_titulo',
          'descricao_fato',
          'registro',
          'acao',
        ]) ??
        columns.map((c) => values[c.name]?.trim()).find(Boolean) ??
        `Linha ${line}`;

      const canonicalDue = parseDateOnly(canonical('prazo'));

      const canonicalValues: Record<string, string> = {};
      for (const [key, name] of nameByCanonical) {
        canonicalValues[key] = values[name]?.trim() ?? '';
      }

      const externalKey = canonical('id');
      let blocked = false;

      const pushIssue = (issue: SheetImportIssue) => {
        if (issues.length < IMPORT_ISSUE_CAP) issues.push({ line, ...issue });
      };

      if (externalKey) {
        if (seenExternalKeys.has(externalKey)) {
          blocked = true;
          pushIssue({
            severity: 'ERROR',
            code: 'DUPLICATE_EXTERNAL_KEY',
            message: `ID repetido no arquivo: "${externalKey}".`,
          });
        } else {
          seenExternalKeys.add(externalKey);
        }
      }

      for (const issue of validateRowValues(canonicalValues)) {
        if (issue.severity === 'ERROR') blocked = true;
        pushIssue(issue);
      }

      return {
        blocked,
        title: title.slice(0, 200),
        externalKey,
        description: pickMappedValue(values, ['descricao_fato', 'descricao', 'description']),
        status: canonical('status_atual') ?? pickMappedValue(values, ['status']),
        priority: canonical('prioridade') ?? pickMappedValue(values, ['prioridade', 'priority']),
        dueDate: (canonicalDue ?? pickDueDateFromNamedValues(values))?.toISOString(),
        values,
      };
    };

    const flush = async (
      rows: ReturnType<typeof toImportRow>[],
      totalHint: number,
    ) => {
      if (quotaReached || rows.length === 0) return;
      const result = await this.importJson(actor, {
        empresaId: input.empresaId,
        title: input.title,
        columns: firstChunk
          ? columns.map(({ sourceHeader: _s, sourceColIndex: _i, ...col }) => col)
          : [],
        rows,
        options: {
          replaceExisting: firstChunk,
          upsertByExternalKey: nameByCanonical.has('id'),
          planId,
          skipColumnSync: !firstChunk,
        },
      });
      planId = result.planId;
      imported += result.imported;
      skipped += result.skipped;
      for (const issue of result.issues) {
        if (issues.length < IMPORT_ISSUE_CAP) issues.push(issue);
        if (issue.code === 'QUOTA_EXCEEDED') quotaReached = true;
      }
      firstChunk = false;
      onProgress?.(globalLine, totalHint);
    };

    const sourcePath = resolveSheetParseSourcePath(meta);
    if (hasPhysicalStaging(meta)) {
      let batch: ReturnType<typeof toImportRow>[] = [];
      let dataRows = 0;
      const width = meta.columnCount || columns.length;
      for await (const physical of iteratePhysicalParseRows(
        actor.tenantId,
        input.parseId,
        IMPORT_FROM_PARSE_BATCH,
      )) {
        for (const row of physical) {
          if (row.line < headerRowIndex) continue;
          if (row.line === headerRowIndex) {
            const headers = headersFromRow(row.values);
            headerIndexByName = new Map(headers.map((header, index) => [header, index]));
            continue;
          }
          if (quotaReached) continue;
          if (!row.values.some((cell) => cell.trim())) continue;
          if (dataRows >= PRODUCT_LIMITS.maxRowsPerTenant) {
            fileTruncated = true;
            continue;
          }
          dataRows += 1;
          globalLine += 1;
          const mapped = mapValues(padRow(row.values, width));
          const importRow = toImportRow(mapped, row.line);
          if (importRow.blocked || isImportRowBlank(importRow)) {
            skipped += 1;
            continue;
          }
          batch.push(importRow);
          if (batch.length >= IMPORT_FROM_PARSE_BATCH) {
            const chunk = batch;
            batch = [];
            await flush(chunk, meta.totalRows);
          }
        }
      }
      await flush(batch, meta.totalRows);
      onProgress?.(imported + skipped, meta.totalRows);
    } else if (sourcePath) {
      let batch: ReturnType<typeof toImportRow>[] = [];
      const streamed = await streamSheetParseSource(
        meta,
        {
          onHeaders: (headers) => {
            headerIndexByName = new Map(headers.map((header, index) => [header, index]));
          },
          onRow: async (_raw, lineNumber, dense) => {
            if (quotaReached) return;
            globalLine += 1;
            const mapped = mapValues(dense);
            const importRow = toImportRow(mapped, lineNumber);
            if (importRow.blocked || isImportRowBlank(importRow)) {
              skipped += 1;
              return;
            }
            batch.push(importRow);
            if (batch.length >= IMPORT_FROM_PARSE_BATCH) {
              const chunk = batch;
              batch = [];
              await flush(chunk, 0);
            }
          },
        },
        { headerRowIndex, columnCount: meta.columnCount || columns.length },
      );
      await flush(batch, streamed.totalRows);
      fileTruncated = streamed.truncated;
      onProgress?.(streamed.totalRows, streamed.totalRows);
    } else {
      for await (const rawBatch of iterateSheetParseRows(
        actor.tenantId,
        input.parseId,
        IMPORT_FROM_PARSE_BATCH,
      )) {
        if (quotaReached) break;
        const rows = rawBatch
          .map((raw) => {
            globalLine += 1;
            return toImportRow(mapValues([], raw), globalLine);
          })
          .filter((row) => {
            if (row.blocked || isImportRowBlank(row)) {
              skipped += 1;
              return false;
            }
            return true;
          });
        if (rows.length > 0) {
          await flush(rows, meta.totalRows);
        }
      }
    }

    if (imported === 0) {
      if (planId) {
        await this.plansRepo.deletePlanIfEmpty(planId, tenantId);
      }
      throw new ValidationError(
        'Nenhuma linha foi importada. Confira a linha de cabeçalho, o mapeamento das colunas e se há dados abaixo do cabeçalho.',
      );
    }

    if (fileTruncated) {
      issues.unshift({
        code: 'IMPORT_TRUNCATED',
        message: importTruncatedMessage(PRODUCT_LIMITS.maxRowsPerTenant),
      });
    }

    if (planId) {
      for (const key of missingRowKeys(keysBeforeImport, [...seenExternalKeys])) {
        if (issues.length >= IMPORT_ISSUE_CAP) break;
        issues.push({
          severity: 'WARNING',
          code: 'ROW_MISSING_FROM_FILE',
          message: `A ação ${key} não veio no arquivo e foi mantida na base.`,
        });
      }
    }

    void deleteSheetParse(actor.tenantId, input.parseId);

    return {
      planId: planId ?? '',
      imported,
      skipped,
      truncated: fileTruncated || quotaReached,
      quotaReached,
      issues,
      headerReport,
    };
  }

  /**
   * Agrega métricas no Postgres e cacheia o resumo (não transfere a planilha).
   */
  async getAnalytics(actor: AuthUser, sheetId: string) {
    await this.assertSheet(actor, sheetId);
    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;
    const cacheKey = sheetAnalyticsCacheKey(actor.tenantId, sheetId, scopeResponsibleId);
    const cached = await cacheGetJson<SheetAnalyticsResult>(cacheKey);
    if (cached) return cached;

    const data = await this.plansRepo.getWorkbookAnalytics(
      sheetId,
      actor.tenantId,
      scopeResponsibleId,
    );
    await cacheSetJson(cacheKey, data, SHEET_META_CACHE_TTL_SEC);
    return data;
  }

  async restoreDefaultCharts(actor: AuthUser, sheetId: string) {
    await this.assertSheet(actor, sheetId);
    const membership = await this.plansRepo.getMembershipSheetCharts(actor.membershipId);
    if (!membership) throw new NotFoundError('Vínculo com a empresa não encontrado');
    await this.plansRepo.updateMembershipSheetCharts(
      membership.id,
      removeSheetCharts(membership.sheetCharts, sheetId),
    );
    return { charts: chartsForSheetWithDefaults(null, sheetId) };
  }

  async getMyCharts(actor: AuthUser, sheetId: string): Promise<{ charts: UserChartSpec[] }> {
    await this.assertSheet(actor, sheetId);
    const membership = await this.plansRepo.getMembershipSheetCharts(actor.membershipId);
    return { charts: chartsForSheetWithDefaults(membership?.sheetCharts, sheetId) };
  }

  async saveMyCharts(
    actor: AuthUser,
    sheetId: string,
    input: SaveMyChartsInput,
  ): Promise<{ charts: UserChartSpec[] }> {
    await this.assertSheet(actor, sheetId);
    const charts = sanitizeUserCharts(input.charts);
    const membership = await this.plansRepo.getMembershipSheetCharts(actor.membershipId);
    if (!membership) throw new NotFoundError('Vínculo com a empresa não encontrado');
    const next = mergeSheetCharts(membership.sheetCharts, sheetId, charts);
    await this.plansRepo.updateMembershipSheetCharts(membership.id, next);
    return { charts };
  }

  async getChartSeries(
    actor: AuthUser,
    sheetId: string,
    input: ChartSeriesInput,
  ): Promise<{ series: Record<string, UserChartSlice[]> }> {
    await this.assertSheet(actor, sheetId);
    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;
    const specs = sanitizeUserCharts(input.specs);
    const entries = await Promise.all(
      specs.map(async (spec) => {
        const slices = await this.plansRepo.getChartSeries(
          sheetId,
          actor.tenantId,
          spec,
          scopeResponsibleId,
        );
        return [spec.id, slices] as const;
      }),
    );
    return { series: Object.fromEntries(entries) };
  }

  async duplicateRow(actor: AuthUser, sheetId: string, rowId: string) {
    await this.assertSheet(actor, sheetId);
    return this.plansService.duplicate(actor, rowId);
  }

  async removeRow(actor: AuthUser, sheetId: string, rowId: string) {
    await this.assertSheet(actor, sheetId);
    return this.plansService.remove(actor, rowId);
  }

  private async assertSheet(actor: AuthUser, sheetId: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const plan = await this.getCachedPlanMeta(actor.tenantId, sheetId);
    if (!plan) throw new NotFoundError('Planilha não encontrada');
    return plan;
  }

  private async getCachedPlanMeta(tenantId: string, planId: string) {
    const key = sheetMetaCacheKey(tenantId, planId);
    const cached = await cacheGetJson<SerializedPlanMeta>(key);
    if (cached) return revivePlanMeta(cached);

    const plan = await this.plansRepo.findPlanMeta(planId, tenantId);
    if (!plan) return null;
    await cacheSetJson(key, plan, SHEET_META_CACHE_TTL_SEC);
    return plan;
  }

  /** rowCount com cache Redis curto; fallback transparente se Redis cair. */
  private async getCachedRowCount(
    tenantId: string,
    planId: string,
    scopeResponsibleId?: string,
  ): Promise<number> {
    const key = sheetRowCountCacheKey(tenantId, planId, scopeResponsibleId);
    const cached = await cacheGet(key);
    if (cached != null && cached !== '') {
      const n = Number(cached);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    const rowCount = await this.plansRepo.countFilledPlanRows(
      planId,
      tenantId,
      scopeResponsibleId,
    );
    await cacheSet(key, String(rowCount), SHEET_META_CACHE_TTL_SEC);
    return rowCount;
  }
}

function pickMappedValue(
  values: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const v = values[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

function isImportRowBlank(row: {
  title: string;
  description?: string;
  dueDate?: string;
  values: Record<string, string>;
}): boolean {
  return isBlankPlanRow({
    title: row.title,
    description: row.description,
    dueDate: row.dueDate ? new Date(row.dueDate) : null,
    fieldValues: Object.entries(row.values).map(([name, value]) => ({
      value,
      column: { name },
    })),
  });
}

function matchTenantMember(
  members: Array<{ user: { id: string; name: string; email: string } }>,
  raw: string,
): { id: string; name: string } | undefined {
  const needle = raw.trim().toLowerCase();
  if (!needle) return undefined;
  const exact = members.find(
    (m) =>
      m.user.name.toLowerCase() === needle || m.user.email.toLowerCase() === needle,
  );
  if (exact) return { id: exact.user.id, name: exact.user.name };
  if (needle.length < 3) return undefined;
  const fuzzy = members.find(
    (m) =>
      m.user.name.toLowerCase().includes(needle) ||
      needle.includes(m.user.name.toLowerCase()) ||
      m.user.email.toLowerCase().includes(needle),
  );
  return fuzzy ? { id: fuzzy.user.id, name: fuzzy.user.name } : undefined;
}

