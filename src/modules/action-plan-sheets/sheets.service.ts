import { inject, injectable } from 'tsyringe';
import {
  ActionPriority,
  ActionStatus,
  ColumnFieldType,
  ColumnHistoryAction,
  ColumnSemanticRole,
} from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@shared/errors/AppError';
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
import { ActionPlansService } from '@modules/action-plans/action-plans.service';
import { ColumnsRepository } from '@modules/columns/columns.repository';
import { inferSemanticRole, pickUniqueSemanticRoles } from '@modules/columns/column-semantics';
import {
  BulkSheetInput,
  ColumnsOrderInput,
  ImportFromParseInput,
  ImportSheetJsonInput,
} from '@modules/action-plans/action-plans.schemas';
import { CreateColumnInput } from '@modules/columns/columns.schemas';
import { normalizeDateValue } from '@modules/imports/sheet-cells';
import {
  deleteSheetParse,
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
  type SheetJob,
  type SheetImportJobResult,
  type SheetJobProgress,
} from './sheet-import.jobs';

const IMPORT_FROM_PARSE_BATCH = 500;
const IMPORT_ISSUE_CAP = 100;

const STATUS_MAP: Record<string, ActionStatus> = {
  pending: ActionStatus.PENDING,
  pendente: ActionStatus.PENDING,
  in_progress: ActionStatus.IN_PROGRESS,
  'em andamento': ActionStatus.IN_PROGRESS,
  completed: ActionStatus.COMPLETED,
  concluido: ActionStatus.COMPLETED,
  delayed: ActionStatus.DELAYED,
  atrasado: ActionStatus.DELAYED,
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

@injectable()
export class SheetsService {
  constructor(
    @inject(ActionPlansRepository) private readonly plansRepo: ActionPlansRepository,
    @inject(ActionPlansService) private readonly plansService: ActionPlansService,
    @inject(ColumnsRepository) private readonly columnsRepo: ColumnsRepository,
  ) {}

  async list(actor: AuthUser) {
    return this.plansService.listPlans(actor);
  }

  async getById(actor: AuthUser, id: string) {
    const plan = await this.plansService.getById(actor, id);
    const columns = await this.columnsRepo.listActive(id);
    const rowCount = await this.plansRepo.countFilledPlanRows(id, actor.tenantId);
    return { ...plan, columns, rowCount, rows: plan.rows ?? [] };
  }

  /**
   * Meta + colunas + rowCount — sem carregar as linhas (planilhas grandes).
   */
  async getSummary(actor: AuthUser, id: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const plan = await this.plansRepo.findPlanMeta(id, actor.tenantId);
    if (!plan) throw new NotFoundError('Planilha não encontrada');
    const columns = await this.columnsRepo.listActive(id);
    const rowCount = await this.plansRepo.countFilledPlanRows(id, actor.tenantId);
    return {
      ...plan,
      columns,
      rowCount,
      rows: [] as unknown[],
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
    const column = await this.columnsRepo.create(actor.tenantId, sheetId, input);
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
    input: { label?: string; required?: boolean; options?: string[]; sortOrder?: number },
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
    return this.columnsRepo.softDelete(columnId, actor.id);
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
            required: col.required,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } else if (existing) {
          await this.columnsRepo.update(col.id!, {
            deletedAt: null,
            isActive: true,
            label: col.label,
            required: col.required,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } else {
          try {
            await this.columnsRepo.create(actor.tenantId, sheetId, {
              name,
              label: col.label,
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
      for (const row of input.rows) {
        await this.plansService.saveSheetRow(actor, sheetId, {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          dueDate: row.dueDate,
          responsibleId: row.responsibleId,
          unitId: row.unitId,
          values: row.values,
        });
      }
    }

    return this.getSummary(actor, sheetId);
  }

  async importJson(actor: AuthUser, input: ImportSheetJsonInput) {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();

    const tenantId = input.empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    const issues: Array<{ line?: number; message: string }> = [];
    let imported = 0;
    let skipped = 0;

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

    if (input.options?.replaceExisting && !input.options?.skipColumnSync) {
      await this.plansRepo.replaceWorkbookContent(plan.id, tenantId);
    }

    if (!input.options?.skipColumnSync) {
      const withRoles = pickUniqueSemanticRoles(
        input.columns.map((col, index) => ({
          ...col,
          semanticRole: inferSemanticRole({
            name: col.name,
            label: col.label,
            fieldType: col.fieldType,
          }),
          sortOrder: col.sortOrder ?? index,
        })),
      );
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
        issues.push({ line, message: 'Título vazio' });
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
        issues.push({ line, message: `Status inválido: ${row.status}` });
        continue;
      }

      const values = (row.values ?? {}) as Record<string, unknown>;
      const dueRaw =
        row.dueDate?.trim() ||
        (dueColumn ? String(values[dueColumn.name] ?? values[dueColumn.id] ?? '') : '');
      const parsedDue = dueRaw ? normalizeDateValue(dueRaw) : { value: '' };
      const dueDate = parsedDue.value ? new Date(parsedDue.value) : undefined;

      const assigneeRaw =
        (assigneeColumn
          ? String(values[assigneeColumn.name] ?? values[assigneeColumn.id] ?? '')
          : '') || '';
      const matched = matchTenantMember(members, assigneeRaw);

      const stringValues = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, String(value ?? '').trim()]),
      ) as Record<string, string>;

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

    const BATCH = 100;
    for (let offset = 0; offset < prepared.length; offset += BATCH) {
      const slice = prepared.slice(offset, offset + BATCH);
      try {
        const created = await this.plansRepo.commitImportChunk({
          tenantId,
          rows: slice.map((row) => ({
            actionPlanId: plan.id,
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
              message:
                rowError instanceof Error ? rowError.message : 'Erro ao importar linha',
            });
          }
        }
        void error;
      }
    }

    return {
      planId: plan.id,
      imported,
      skipped,
      issues,
    };
  }

  /**
   * Recebe o arquivo, devolve jobId na hora e lê em background (JSONL incremental).
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
      try {
        const fs = await import('fs');
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
    await onProgress?.({ current: 0, total: 0, phase: 'import' });
    const result = await this.importFromParse(actor, input, (current, total) => {
      void onProgress?.({ current, total, phase: 'import' });
    });
    await onProgress?.({
      current: result.imported + result.skipped,
      total: result.imported + result.skipped,
      phase: 'import',
    });
    return result;
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

    const columns = input.columns.map((col, index) => ({
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

    let planId: string | undefined;
    let imported = 0;
    let skipped = 0;
    const issues: Array<{ line?: number; message: string }> = [];
    let globalLine = 0;
    let firstChunk = true;
    let headerIndexByName = new Map<string, number>();

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
      const title =
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

      return {
        title: title.slice(0, 200),
        description: pickMappedValue(values, ['descricao_fato', 'descricao', 'description']),
        status: pickMappedValue(values, ['status']),
        priority: pickMappedValue(values, ['prioridade', 'priority']),
        dueDate: pickMappedValue(values, ['data_fim', 'prazo', 'dueDate', 'due_date']),
        values,
      };
    };

    const flush = async (
      rows: ReturnType<typeof toImportRow>[],
      totalHint: number,
    ) => {
      if (rows.length === 0) return;
      const result = await this.importJson(actor, {
        empresaId: input.empresaId,
        title: input.title,
        columns: firstChunk
          ? columns.map(({ sourceHeader: _s, sourceColIndex: _i, ...col }) => col)
          : [],
        rows,
        options: {
          replaceExisting: firstChunk,
          planId,
          skipColumnSync: !firstChunk,
        },
      });
      planId = result.planId;
      imported += result.imported;
      skipped += result.skipped;
      for (const issue of result.issues) {
        if (issues.length < IMPORT_ISSUE_CAP) issues.push(issue);
      }
      firstChunk = false;
      onProgress?.(globalLine, totalHint);
    };

    const sourcePath = resolveSheetParseSourcePath(meta);
    if (sourcePath) {
      let batch: ReturnType<typeof toImportRow>[] = [];
      const streamed = await streamSheetParseSource(
        meta,
        {
          onHeaders: (headers) => {
            headerIndexByName = new Map(headers.map((header, index) => [header, index]));
          },
          onRow: async (_raw, lineNumber, dense) => {
            globalLine += 1;
            const mapped = mapValues(dense);
            const importRow = toImportRow(mapped, lineNumber);
            if (isImportRowBlank(importRow)) {
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
      onProgress?.(streamed.totalRows, streamed.totalRows);
    } else {
      for await (const rawBatch of iterateSheetParseRows(
        actor.tenantId,
        input.parseId,
        IMPORT_FROM_PARSE_BATCH,
      )) {
        const rows = rawBatch
          .map((raw) => {
            globalLine += 1;
            return toImportRow(mapValues([], raw), globalLine);
          })
          .filter((row) => {
            if (isImportRowBlank(row)) {
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

    void deleteSheetParse(actor.tenantId, input.parseId);

    return {
      planId: planId ?? '',
      imported,
      skipped,
      issues,
    };
  }

  /**
   * Agrega métricas no servidor (não envia 65k linhas ao browser).
   */
  async getAnalytics(actor: AuthUser, sheetId: string) {
    await this.assertSheet(actor, sheetId);
    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;
    const rows = await this.plansRepo.iteratePlanRowsForAnalytics(
      sheetId,
      actor.tenantId,
      1000,
      scopeResponsibleId,
    );

    const now = new Date();
    const in7 = new Date(now);
    in7.setDate(in7.getDate() + 7);

    let total = 0;
    let concluidas = 0;
    let atrasadas = 0;
    let aVencer7d = 0;
    let onTimeCompleted = 0;
    const byStatus = new Map<string, number>();
    const byPrioridade = new Map<string, number>();
    const byIndicador = new Map<string, number>();
    const byUnidade = new Map<string, number>();
    const byResponsavel = new Map<string, number>();

    for (const row of rows) {
      const values: Record<string, string> = {};
      for (const fv of row.fieldValues) {
        const v = fv.value;
        values[fv.column.name] =
          v == null ? '' : typeof v === 'string' ? v : String(v);
      }
      // preenche campos nativos se ausentes
      if (!values.status) values.status = String(row.status);
      if (!values.prioridade && !values.priority) {
        values.prioridade = String(row.priority);
      }
      if (!values.data_fim && row.dueDate) {
        values.data_fim = row.dueDate.toISOString().slice(0, 10);
      }

      const hasData = !isBlankPlanRow({
        title: row.title,
        description: row.description,
        responsibleName: null,
        unitName: null,
        dueDate: row.dueDate,
        fieldValues: row.fieldValues,
      });
      if (!hasData) continue;
      total += 1;

      const status = (values.status || row.status || '').toLowerCase();
      const statusFinal = (values.status_final || '').toLowerCase();
      const isDone =
        status.includes('conclu') ||
        status === 'completed' ||
        statusFinal.startsWith('conclu');
      if (isDone) {
        concluidas += 1;
        if (statusFinal.includes('prazo') || !statusFinal.includes('atraso')) {
          onTimeCompleted += 1;
        }
      }

      const due = row.dueDate ?? (values.data_fim ? new Date(values.data_fim) : null);
      if (
        due &&
        !isDone &&
        !status.includes('cancel') &&
        due < now
      ) {
        atrasadas += 1;
      } else if (due && !isDone && due >= now && due <= in7) {
        aVencer7d += 1;
      }

      const statusKey = values.status || String(row.status);
      byStatus.set(statusKey, (byStatus.get(statusKey) ?? 0) + 1);

      const prio = values.prioridade || values.priority || String(row.priority);
      if (prio.trim()) byPrioridade.set(prio, (byPrioridade.get(prio) ?? 0) + 1);

      const ind = values.indicador || values.programa || values.tema || '';
      if (ind.trim()) byIndicador.set(ind, (byIndicador.get(ind) ?? 0) + 1);

      const uni = values.unidade || '';
      if (uni.trim()) byUnidade.set(uni, (byUnidade.get(uni) ?? 0) + 1);

      const resp = values.responsavel || '';
      if (resp.trim()) byResponsavel.set(resp, (byResponsavel.get(resp) ?? 0) + 1);
    }

    const toSlices = (map: Map<string, number>) =>
      Array.from(map.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);

    const aderenciaPct =
      concluidas > 0 ? Math.round((onTimeCompleted / concluidas) * 100) : 0;
    const conclusaoPct = total > 0 ? Math.round((concluidas / total) * 100) : 0;

    return {
      totalAcoes: total,
      rowCount: total,
      byStatus: toSlices(byStatus),
      byPrioridade: toSlices(byPrioridade).map((s) => ({
        ...s,
        percent: total > 0 ? Math.round((s.value / total) * 100) : 0,
      })),
      byIndicador: toSlices(byIndicador),
      byUnidadeTop10: toSlices(byUnidade).slice(0, 10),
      byResponsavelTop10: toSlices(byResponsavel).slice(0, 10),
      kpis: {
        total,
        concluidas,
        atrasadas,
        aVencer7d,
        aderenciaPct,
        conclusaoPct,
      },
      filterOptions: {
        years: [] as string[],
        responsaveis: toSlices(byResponsavel).map((s) => s.label),
        unidades: toSlices(byUnidade).map((s) => s.label),
        locais: [] as string[],
        gestores: [] as string[],
        customColumns: [] as Array<{ key: string; label: string; values: string[] }>,
      },
    };
  }

  private async assertSheet(actor: AuthUser, sheetId: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const plan = await this.plansRepo.findPlan(sheetId, actor.tenantId);
    if (!plan) throw new NotFoundError('Planilha não encontrada');
    return plan;
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

