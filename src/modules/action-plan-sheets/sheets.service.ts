import { inject, injectable } from 'tsyringe';
import {
  ActionPriority,
  ActionStatus,
  ColumnFieldType,
  ColumnHistoryAction,
} from '@prisma/client';
import { ForbiddenError, NotFoundError } from '@shared/errors/AppError';
import { AuthUser } from '@/types/auth';
import {
  canCreateActions,
  canImportSpreadsheet,
  canManageColumns,
  isPlatformAdmin,
} from '@shared/helpers/rbac';
import { ActionPlansRepository } from '@modules/action-plans/action-plans.repository';
import { ActionPlansService } from '@modules/action-plans/action-plans.service';
import { ColumnsRepository } from '@modules/columns/columns.repository';
import {
  BulkSheetInput,
  ColumnsOrderInput,
  ImportFromParseInput,
  ImportSheetJsonInput,
} from '@modules/action-plans/action-plans.schemas';
import { CreateColumnInput } from '@modules/columns/columns.schemas';
import { parseSpreadsheetFile } from '@modules/imports/imports.parser';
import {
  deleteSheetParse,
  iterateSheetParseRows,
  loadSheetParseMeta,
  readSheetParseSample,
  saveSheetParse,
} from './sheet-parse.store';

const SAMPLE_ROWS = 50;
const IMPORT_FROM_PARSE_BATCH = 500;

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
    const columns = await this.columnsRepo.listActive(actor.tenantId);
    const rowCount = await this.plansRepo.countPlanRows(id);
    return { ...plan, columns, rowCount, rows: plan.rows ?? [] };
  }

  /**
   * Meta + colunas + rowCount — sem carregar as linhas (planilhas grandes).
   */
  async getSummary(actor: AuthUser, id: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const plan = await this.plansRepo.findPlanMeta(id, actor.tenantId);
    if (!plan) throw new NotFoundError('Planilha não encontrada');
    const columns = await this.columnsRepo.listActive(actor.tenantId);
    const rowCount = await this.plansRepo.countPlanRows(id);
    return {
      ...plan,
      columns,
      rowCount,
      rows: [] as unknown[],
    };
  }

  async getOrCreateForEmpresa(actor: AuthUser, empresaId?: string) {
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    const tenantId = empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    let plan = await this.plansRepo.findPrimaryPlan(tenantId);
    if (!plan) {
      if (!canCreateActions(actor)) throw new ForbiddenError();
      plan = await this.plansRepo.createPlan({
        tenantId,
        ownerId: actor.id,
        title: 'Planilha principal',
      });
    }
    return this.getSummary(actor, plan.id);
  }

  async listRows(
    actor: AuthUser,
    sheetId: string,
    query: { page: number; pageSize: number; search?: string },
  ) {
    await this.assertSheet(actor, sheetId);
    const { items, total } = await this.plansRepo.listPlanRows(
      sheetId,
      actor.tenantId,
      query,
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
    const column = await this.columnsRepo.create(actor.tenantId, input);
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
    const existing = await this.columnsRepo.findById(columnId, actor.tenantId);
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
    return this.columnsRepo.listActive(actor.tenantId);
  }

  async resetColumns(actor: AuthUser, sheetId: string) {
    await this.assertSheet(actor, sheetId);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const columns = await this.columnsRepo.listActive(actor.tenantId);
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
        if (col.id) {
          await this.columnsRepo.update(col.id, {
            label: col.label,
            required: col.required,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } else {
          const name = col.name
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, '_')
            .replace(/^[^a-z]/, 'c_')
            .slice(0, 60);
          try {
            await this.columnsRepo.create(actor.tenantId, {
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
        if (row.id) {
          await this.plansService.updateRow(actor, row.id, {
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            dueDate: row.dueDate,
            responsibleId: row.responsibleId,
            unitId: row.unitId,
            values: row.values,
          });
        } else {
          await this.plansService.addRow(actor, sheetId, {
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

    if (!input.options?.skipColumnSync) {
      for (const [index, col] of input.columns.entries()) {
        const name = col.name
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, '_')
          .replace(/^[^a-z]/, 'c_')
          .slice(0, 60);
        try {
          await this.columnsRepo.create(tenantId, {
            name,
            label: col.label,
            fieldType: col.fieldType ?? ColumnFieldType.TEXT,
            required: col.required ?? false,
            options: col.options,
            sortOrder: col.sortOrder ?? index,
          });
        } catch {
          // column may already exist
        }
      }
    }

    const columns = await this.columnsRepo.listActive(tenantId);
    const columnByKey = new Map<string, (typeof columns)[number]>();
    for (const col of columns) {
      columnByKey.set(col.id, col);
      columnByKey.set(col.name, col);
    }

    type PreparedRow = {
      line: number;
      title: string;
      description?: string;
      status: ActionStatus;
      priority: ActionPriority;
      dueDate?: Date;
      responsibleId?: string;
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

      prepared.push({
        line,
        title: row.title,
        description: row.description,
        status: status ?? ActionStatus.PENDING,
        priority: priority ?? ActionPriority.MEDIUM,
        dueDate: row.dueDate ? new Date(row.dueDate) : undefined,
        responsibleId: row.responsibleId,
        unitId: row.unitId,
        values: row.values ?? {},
      });
    }

    const BATCH = 100;
    for (let offset = 0; offset < prepared.length; offset += BATCH) {
      const slice = prepared.slice(offset, offset + BATCH);
      try {
        const created = await this.plansRepo.createRowsBatch(
          slice.map((row) => ({
            actionPlanId: plan.id,
            title: row.title,
            description: row.description,
            status: row.status,
            priority: row.priority,
            dueDate: row.dueDate,
            responsibleId: row.responsibleId,
            unitId: row.unitId,
          })),
          50,
        );

        const fieldValues: Array<{
          actionRowId: string;
          columnId: string;
          value: import('@prisma/client').Prisma.InputJsonValue;
        }> = [];

        for (let i = 0; i < created.length; i += 1) {
          const rowId = created[i].id;
          const source = slice[i];
          for (const [key, raw] of Object.entries(source.values)) {
            const column = columnByKey.get(key);
            if (!column || raw == null || raw === '') continue;
            fieldValues.push({
              actionRowId: rowId,
              columnId: column.id,
              value: raw as import('@prisma/client').Prisma.InputJsonValue,
            });
          }
        }

        if (fieldValues.length > 0) {
          await this.plansRepo.createFieldValuesBatch(fieldValues);
        }

        await this.plansRepo.createHistoryBatch(
          created.map((row, i) => ({
            actionRowId: row.id,
            actorId: actor.id,
            toStatus: slice[i].status,
            comment: 'Importado da planilha',
          })),
        );

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
   * Lê a planilha no servidor (ExcelJS stream) e guarda o resultado em disco (JSONL).
   * O cliente recebe só metadados + amostra — não trava o navegador.
   */
  async parseUpload(
    actor: AuthUser,
    file: Express.Multer.File,
  ): Promise<{
    parseId: string;
    fileName: string;
    sheetName: string;
    headers: string[];
    totalRows: number;
    sampleRows: Record<string, string>[];
    emptyColumns: string[];
  }> {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();
    if (!file?.path) {
      throw new NotFoundError('Arquivo não recebido');
    }

    try {
      const parsed = await parseSpreadsheetFile(file.path);
      const { headers, rows: uniquedRows } = uniquifyHeaders(
        parsed.headers,
        parsed.rows.map((r) => r.rawData),
      );

      const emptyColumns = headers.filter(
        (header) => !uniquedRows.some((row) => row[header]?.trim()),
      );

      const stored = await saveSheetParse({
        tenantId: actor.tenantId,
        fileName: file.originalname,
        sheetName: 'Planilha 1',
        headers,
        rows: uniquedRows,
        emptyColumns,
      });

      const sampleRows = await readSheetParseSample(
        actor.tenantId,
        stored.parseId,
        SAMPLE_ROWS,
      );

      return {
        parseId: stored.parseId,
        fileName: stored.fileName,
        sheetName: stored.sheetName,
        headers: stored.headers,
        totalRows: stored.totalRows,
        sampleRows,
        emptyColumns: stored.emptyColumns,
      };
    } finally {
      try {
        const fs = await import('fs');
        if (file.path) fs.unlinkSync(file.path);
      } catch {
        // ignore
      }
    }
  }

  async importFromParse(actor: AuthUser, input: ImportFromParseInput) {
    if (!canImportSpreadsheet(actor)) throw new ForbiddenError();
    if (isPlatformAdmin(actor)) throw new ForbiddenError();

    const tenantId = input.empresaId ?? actor.tenantId;
    if (tenantId !== actor.tenantId) throw new ForbiddenError();

    const meta = await loadSheetParseMeta(actor.tenantId, input.parseId);

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
    }));

    let planId: string | undefined;
    let imported = 0;
    let skipped = 0;
    const issues: Array<{ line?: number; message: string }> = [];
    let globalLine = 0;
    let firstChunk = true;

    for await (const rawBatch of iterateSheetParseRows(
      actor.tenantId,
      input.parseId,
      IMPORT_FROM_PARSE_BATCH,
    )) {
      const rows = rawBatch.map((raw) => {
        globalLine += 1;
        const values: Record<string, string> = {};
        for (const col of columns) {
          values[col.name] = raw[col.sourceHeader] ?? '';
        }

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
          `Linha ${globalLine}`;

        return {
          title: title.slice(0, 200),
          description: pickMappedValue(values, ['descricao_fato', 'descricao', 'description']),
          status: pickMappedValue(values, ['status']),
          priority: pickMappedValue(values, ['prioridade', 'priority']),
          dueDate: pickMappedValue(values, ['data_fim', 'prazo', 'dueDate', 'due_date']),
          values,
        };
      });

      const result = await this.importJson(actor, {
        empresaId: input.empresaId,
        title: input.title,
        columns: firstChunk
          ? columns.map(({ sourceHeader: _s, ...col }) => col)
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
        issues.push(issue);
      }
      firstChunk = false;
    }

    void deleteSheetParse(actor.tenantId, input.parseId);
    void meta;

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
    const rows = await this.plansRepo.iteratePlanRowsForAnalytics(
      sheetId,
      actor.tenantId,
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

      const hasData =
        Object.values(values).some((v) => v?.trim()) || Boolean(row.title?.trim());
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
      rowCount: rows.length,
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

/** Garante headers únicos (igual ao parser do front). */
function uniquifyHeaders(
  rawHeaders: string[],
  rows: Record<string, string>[],
): { headers: string[]; rows: Record<string, string>[] } {
  const headers: string[] = [];
  const headerIndex = new Map<string, number>();

  rawHeaders.forEach((cell, index) => {
    const label = (cell || `Coluna ${index + 1}`).trim() || `Coluna ${index + 1}`;
    let unique = label;
    let n = 2;
    while (headerIndex.has(unique)) {
      unique = `${label} (${n})`;
      n += 1;
    }
    headers.push(unique);
    headerIndex.set(unique, index);
  });

  const remapped = rows.map((row) => {
    const next: Record<string, string> = {};
    headers.forEach((header, index) => {
      const original = rawHeaders[index];
      next[header] = row[header] ?? row[original] ?? '';
    });
    return next;
  });

  return { headers, rows: remapped };
}
