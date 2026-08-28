import { inject, injectable } from 'tsyringe';
import {
  ActionPriority,
  ActionStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { setTransactionTenant } from '@shared/tenancy/prisma-tenant';
import { isBlankPlanRow, AUTO_COLUMN_NAMES } from '@shared/helpers/plan-row-blank';
import { ListActionsQuery } from './action-plans.schemas';
import {
  mapWorkbookAnalytics,
  type SheetAnalyticsResult,
} from './workbook-analytics';
import {
  buildCells,
  cellsToFieldValues,
  mergeCells,
} from './row-cells';
import type { UserChartSlice, UserChartSpec } from '@modules/action-plan-sheets/user-charts';

@injectable()
export class ActionPlansRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listPlans(tenantId: string) {
    return this.prisma.actionPlan.findMany({
      where: { tenantId },
      include: {
        unit: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { rows: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Meta do plano — nunca carrega linhas (planilhas grandes). */
  findPlan(id: string, tenantId: string) {
    return this.prisma.actionPlan.findFirst({
      where: { id, tenantId },
      include: {
        unit: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { rows: { where: { deletedAt: null } } } },
      },
    });
  }

  createPlan(data: {
    tenantId: string;
    ownerId: string;
    title: string;
    description?: string;
    unitId?: string;
    year?: number;
    month?: number;
  }) {
    return this.prisma.actionPlan.create({ data });
  }

  createRow(data: {
    id?: string;
    actionPlanId: string;
    title: string;
    description?: string;
    unitId?: string;
    responsibleId?: string;
    status?: ActionStatus;
    priority?: ActionPriority;
    dueDate?: Date;
    externalKey?: string;
    responsibleName?: string;
    unitName?: string;
  }) {
    return this.prisma.actionPlanRow.create({ data });
  }

  /**
   * Insere várias linhas de uma vez (importação em massa).
   * Retorna os IDs na mesma ordem do input (via createMany + findMany por janela temporal
   * não é confiável; por isso criamos em lotes menores com create e coletamos ids,
   * ou usamos createMany + retorno explícito quando disponível).
   *
   * Prisma createMany não retorna IDs no Postgres — usamos create em paralelo limitado
   * via Promise.all em chunks para equilibrar throughput e obter IDs para field values.
   */
  async createRowsBatch(
    rows: Array<{
      actionPlanId: string;
      title: string;
      description?: string;
      unitId?: string;
      responsibleId?: string;
      status?: ActionStatus;
      priority?: ActionPriority;
      dueDate?: Date;
      externalKey?: string;
      responsibleName?: string;
    }>,
    chunkSize = 50,
  ) {
    const created: Array<{ id: string }> = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      const slice = rows.slice(i, i + chunkSize);
      const batch = await Promise.all(
        slice.map((data) => this.prisma.actionPlanRow.create({ data, select: { id: true } })),
      );
      created.push(...batch);
    }
    return created;
  }

  async commitImportChunk(input: {
    tenantId: string;
    rows: Array<{
      actionPlanId: string;
      title: string;
      description?: string;
      unitId?: string;
      responsibleId?: string;
      responsibleName?: string;
      status?: ActionStatus;
      priority?: ActionPriority;
      dueDate?: Date;
    }>;
    values: Array<Record<string, unknown>>;
    columnByKey: Map<string, { id: string }>;
    actorId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await setTransactionTenant(tx, input.tenantId);
      const data = input.rows.map((row, i) => ({
        ...row,
        cells: buildCells(input.values[i], input.columnByKey),
      }));
      const result = await tx.actionPlanRow.createMany({ data });
      return Array.from({ length: result.count }, () => ({ id: '' }));
    });
  }

  async findRow(id: string, tenantId: string, includeDeleted = false) {
    const row = await this.prisma.actionPlanRow.findFirst({
      where: {
        id,
        actionPlan: { tenantId },
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      include: {
        actionPlan: true,
        responsible: { select: { id: true, name: true, email: true } },
        unit: true,
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { actor: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!row) return null;
    return { ...row, fieldValues: cellsToFieldValues(row.cells) };
  }

  updateRow(id: string, data: Prisma.ActionPlanRowUpdateInput) {
    return this.prisma.actionPlanRow.update({ where: { id }, data });
  }

  async upsertFieldValues(
    actionRowId: string,
    tenantId: string,
    values: Record<string, unknown>,
    actionPlanId?: string,
  ) {
    const columns = await this.prisma.actionColumn.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(actionPlanId ? { actionPlanId } : {}),
        OR: [
          { id: { in: Object.keys(values) } },
          { name: { in: Object.keys(values) } },
        ],
      },
    });

    const byKey = new Map<string, (typeof columns)[number]>();
    for (const col of columns) {
      byKey.set(col.id, col);
      byKey.set(col.name, col);
    }

    const row = await this.prisma.actionPlanRow.findFirst({
      where: { id: actionRowId, actionPlan: { tenantId } },
      select: { cells: true },
    });
    if (!row) return;

    await this.prisma.actionPlanRow.update({
      where: { id: actionRowId },
      data: { cells: mergeCells(row.cells, values, byKey) },
    });
  }

  findPrimaryPlan(tenantId: string) {
    return this.prisma.actionPlan.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  findPlanMeta(id: string, tenantId: string) {
    return this.prisma.actionPlan.findFirst({
      where: { id, tenantId },
    });
  }

  countPlanRows(actionPlanId: string) {
    return this.prisma.actionPlanRow.count({
      where: { actionPlanId, deletedAt: null },
    });
  }

  /**
   * Contagem rápida de linhas ativas (não deletadas).
   * Antes iterava até 2000 linhas + fieldValues só para filtrar vazias — isso
   * tornava GET /primary e GET /rows extremamente lentos.
   * Linhas em branco continuam sendo tratadas no FE (KPIs) e em softDeleteBlankRows.
   */
  async countFilledPlanRows(
    actionPlanId: string,
    tenantId: string,
    scopeResponsibleId?: string,
  ) {
    return this.prisma.actionPlanRow.count({
      where: {
        actionPlanId,
        deletedAt: null,
        actionPlan: { tenantId },
        ...(scopeResponsibleId ? { responsibleId: scopeResponsibleId } : {}),
      },
    });
  }

  softDeleteRows(ids: string[]) {
    if (ids.length === 0) return Promise.resolve({ count: 0 });
    const BATCH = 500;
    const batches: Promise<{ count: number }>[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      batches.push(
        this.prisma.actionPlanRow.updateMany({
          where: { id: { in: chunk }, deletedAt: null },
          data: { deletedAt: new Date() },
        }),
      );
    }
    return Promise.all(batches).then((results) => ({
      count: results.reduce((sum, r) => sum + r.count, 0),
    }));
  }

  async hardDeleteRows(ids: string[]) {
    if (ids.length === 0) return { count: 0 };
    const BATCH = 500;
    let count = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const deleted = await this.prisma.actionPlanRow.deleteMany({
        where: { id: { in: chunk } },
      });
      count += deleted.count;
    }
    return { count };
  }

  async softDeleteBlankRows(
    actionPlanId: string,
    tenantId: string,
    scopeResponsibleId?: string,
  ) {
    let deleted = 0;
    const pageSize = 2000;
    let skip = 0;

    const autoColumns = await this.prisma.actionColumn.findMany({
      where: {
        actionPlanId,
        deletedAt: null,
        name: { in: [...AUTO_COLUMN_NAMES] },
      },
      select: { id: true },
    });
    const autoColumnIds = new Set(autoColumns.map((column) => column.id));

    for (;;) {
      const rows = await this.prisma.actionPlanRow.findMany({
        where: {
          actionPlanId,
          deletedAt: null,
          actionPlan: { tenantId },
          ...(scopeResponsibleId ? { responsibleId: scopeResponsibleId } : {}),
        },
        select: {
          id: true,
          title: true,
          description: true,
          dueDate: true,
          responsibleName: true,
          unitName: true,
          cells: true,
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: pageSize,
      });
      if (rows.length === 0) break;

      const blankIds = rows
        .filter((row) => isBlankPlanRow({ ...row, autoColumnIds }))
        .map((row) => row.id);
      if (blankIds.length > 0) {
        await this.hardDeleteRows(blankIds);
        deleted += blankIds.length;
      }

      skip += pageSize;
      if (rows.length < pageSize) break;
    }

    return deleted;
  }

  /** Remove plano sem linhas (ex.: importação que não gravou registros). */
  async deletePlanIfEmpty(planId: string, tenantId: string): Promise<boolean> {
    const count = await this.countPlanRows(planId);
    if (count > 0) return false;
    const deleted = await this.prisma.actionPlan.deleteMany({
      where: { id: planId, tenantId },
    });
    return deleted.count > 0;
  }

  async listPlanRows(
    actionPlanId: string,
    tenantId: string,
    query: { page: number; pageSize: number; search?: string },
    scopeResponsibleId?: string,
  ) {
    const where: Prisma.ActionPlanRowWhereInput = {
      actionPlanId,
      deletedAt: null,
      actionPlan: { tenantId },
      ...(scopeResponsibleId ? { responsibleId: scopeResponsibleId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { responsibleName: { contains: query.search, mode: 'insensitive' } },
              { unitName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.actionPlanRow.findMany({
        where,
        include: {
          responsible: { select: { id: true, name: true, email: true } },
          unit: true,
        },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.actionPlanRow.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        ...row,
        fieldValues: cellsToFieldValues(row.cells),
      })),
      total,
    };
  }

  /** Apaga linhas e colunas do workbook para um replace real. */
  async replaceWorkbookContent(actionPlanId: string, tenantId: string) {
    await this.prisma.$transaction(async (tx) => {
      await setTransactionTenant(tx, tenantId);
      const plan = await tx.actionPlan.findFirst({
        where: { id: actionPlanId, tenantId },
        select: { id: true },
      });
      if (!plan) return;
      await tx.actionPlanRow.deleteMany({ where: { actionPlanId } });
      await tx.actionColumn.deleteMany({ where: { actionPlanId } });
    });
  }

  listTenantMembers(tenantId: string) {
    return this.prisma.membership.findMany({
      where: { tenantId, isActive: true },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  updatePlan(
    id: string,
    data: { title?: string; description?: string; unitId?: string | null },
  ) {
    return this.prisma.actionPlan.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        unitId: data.unitId === undefined ? undefined : data.unitId,
      },
    });
  }

  getClient() {
    return this.prisma;
  }

  softDeleteRow(id: string) {
    return this.prisma.actionPlanRow.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  restoreRow(id: string) {
    return this.prisma.actionPlanRow.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  listRowsForUser(tenantId: string, responsibleId: string) {
    return this.prisma.actionPlanRow.findMany({
      where: {
        responsibleId,
        deletedAt: null,
        actionPlan: { tenantId },
      },
      include: {
        actionPlan: { select: { id: true, title: true } },
        unit: true,
      },
      orderBy: { dueDate: 'asc' },
      take: 200,
    });
  }

  async listActions(tenantId: string, query: ListActionsQuery, scopeResponsibleId?: string) {
    const where: Prisma.ActionPlanRowWhereInput = {
      actionPlan: {
        tenantId,
        ...(query.actionPlanId ? { id: query.actionPlanId } : {}),
      },
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(scopeResponsibleId
        ? { responsibleId: scopeResponsibleId }
        : query.responsibleId
          ? { responsibleId: query.responsibleId }
          : {}),
      ...(query.from || query.to
        ? {
            dueDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { responsibleName: { contains: query.search, mode: 'insensitive' } },
              { unitName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.actionPlanRow.findMany({
        where,
        include: {
          actionPlan: { select: { id: true, title: true } },
          responsible: { select: { id: true, name: true, email: true } },
          unit: true,
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.actionPlanRow.count({ where }),
    ]);

    return { items, total };
  }

  addHistory(data: {
    actionRowId: string;
    actorId?: string;
    fromStatus?: ActionStatus | null;
    toStatus?: ActionStatus | null;
    comment?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.actionHistory.create({
      data: {
        actionRowId: data.actionRowId,
        actorId: data.actorId,
        fromStatus: data.fromStatus ?? undefined,
        toStatus: data.toStatus ?? undefined,
        comment: data.comment,
        metadata: data.metadata,
      },
    });
  }

  duplicateRow(sourceId: string, data: Prisma.ActionPlanRowCreateInput) {
    return this.prisma.actionPlanRow.create({ data });
  }

  /**
   * Agrega KPIs no Postgres — só o resumo sai do Neon (egress).
   */
  async getWorkbookAnalytics(
    actionPlanId: string,
    tenantId: string,
    scopeResponsibleId?: string,
  ): Promise<SheetAnalyticsResult> {
    const kpiRows = await this.prisma.$queryRaw<
      Array<{
        total: number;
        concluidas: number;
        on_time_completed: number;
        atrasadas: number;
        a_vencer_7d: number;
        no_prazo: number;
        cancelados: number;
      }>
    >`
      WITH cols AS (
        SELECT
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'status_atual'),
            MAX(id::text) FILTER (WHERE name = 'status')
          ) AS status_id,
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'status_final'),
            MAX(id::text) FILTER (WHERE name = 'status_final')
          ) AS status_final_id,
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'prazo'),
            MAX(id::text) FILTER (WHERE name IN ('data_fim', 'prazo')),
            MAX(id::text) FILTER (WHERE name LIKE 'prazo%'),
            MAX(id::text) FILTER (WHERE name IN ('data_conclusao', 'data_prox_verificacao')),
            MAX(id::text) FILTER (WHERE semantic_role = 'DUE_DATE'::"ColumnSemanticRole"),
            MAX(id::text) FILTER (
              WHERE field_type = 'DATE'::"ColumnFieldType"
                AND (name LIKE 'data_%' OR name LIKE 'prazo%')
            )
          ) AS due_id
        FROM action_columns
        WHERE action_plan_id = ${actionPlanId}
          AND deleted_at IS NULL
      ),
      scoped AS (
        SELECT r.status::text AS native_status, r.due_date, r.cells,
               cols.status_id, cols.status_final_id, cols.due_id
        FROM action_plan_rows r
        INNER JOIN action_plans p ON p.id = r.action_plan_id
        CROSS JOIN cols
        WHERE r.action_plan_id = ${actionPlanId}
          AND p.tenant_id = ${tenantId}
          AND r.deleted_at IS NULL
          ${scopeResponsibleId ? Prisma.sql`AND r.responsible_id = ${scopeResponsibleId}` : Prisma.sql``}
      ),
      enriched AS (
        SELECT
          LOWER(COALESCE(NULLIF(TRIM(s.cells ->> s.status_id), ''), s.native_status, '')) AS status_l,
          LOWER(COALESCE(s.cells ->> s.status_final_id, '')) AS status_final_l,
          COALESCE(
            s.due_date,
            CASE
              WHEN (s.cells ->> s.due_id) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                THEN LEFT(s.cells ->> s.due_id, 10)::date::timestamptz
              ELSE NULL
            END
          ) AS due
        FROM scoped s
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE status_l LIKE '%conclu%' OR status_l = 'completed' OR status_final_l LIKE 'conclu%'
        )::int AS concluidas,
        COUNT(*) FILTER (
          WHERE (status_l LIKE '%conclu%' OR status_l = 'completed' OR status_final_l LIKE 'conclu%')
            AND (status_final_l LIKE '%prazo%' OR status_final_l NOT LIKE '%atraso%')
        )::int AS on_time_completed,
        COUNT(*) FILTER (
          WHERE status_l NOT LIKE '%conclu%' AND status_l <> 'completed' AND status_l NOT LIKE '%cancel%'
            AND due IS NOT NULL AND due < NOW()
        )::int AS atrasadas,
        COUNT(*) FILTER (
          WHERE status_l NOT LIKE '%conclu%' AND status_l <> 'completed'
            AND due IS NOT NULL AND due >= NOW() AND due <= NOW() + INTERVAL '7 days'
        )::int AS a_vencer_7d,
        COUNT(*) FILTER (
          WHERE status_l NOT LIKE '%conclu%' AND status_l <> 'completed' AND status_l NOT LIKE '%cancel%'
            AND status_l NOT LIKE '%atras%'
            AND due IS NOT NULL AND due::date >= CURRENT_DATE
        )::int AS no_prazo,
        COUNT(*) FILTER (
          WHERE status_l LIKE '%cancel%' OR status_final_l = 'cancelada'
        )::int AS cancelados
      FROM enriched
    `;

    const groupRows = await this.prisma.$queryRaw<
      Array<{ bucket: string; label: string; cnt: number }>
    >`
      WITH cols AS (
        SELECT
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'status_atual'),
            MAX(id::text) FILTER (WHERE name = 'status')
          ) AS status_id,
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'prioridade'),
            MAX(id::text) FILTER (WHERE name IN ('prioridade', 'priority'))
          ) AS priority_id,
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'tema'),
            MAX(id::text) FILTER (WHERE name IN ('indicador', 'programa', 'tema'))
          ) AS indicador_id,
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'unidade'),
            MAX(id::text) FILTER (WHERE name = 'unidade')
          ) AS unidade_id,
          COALESCE(
            MAX(id::text) FILTER (WHERE canonical_key = 'responsavel_solucao'),
            MAX(id::text) FILTER (WHERE name = 'responsavel')
          ) AS responsavel_id
        FROM action_columns
        WHERE action_plan_id = ${actionPlanId}
          AND deleted_at IS NULL
      ),
      scoped AS (
        SELECT r.id, r.status::text AS native_status, r.priority::text AS native_priority,
               r.responsible_name, r.unit_name, r.cells,
               cols.status_id, cols.priority_id, cols.indicador_id, cols.unidade_id, cols.responsavel_id
        FROM action_plan_rows r
        INNER JOIN action_plans p ON p.id = r.action_plan_id
        CROSS JOIN cols
        WHERE r.action_plan_id = ${actionPlanId}
          AND p.tenant_id = ${tenantId}
          AND r.deleted_at IS NULL
          ${scopeResponsibleId ? Prisma.sql`AND r.responsible_id = ${scopeResponsibleId}` : Prisma.sql``}
      ),
      labeled AS (
        SELECT s.id, 'status'::text AS bucket,
               COALESCE(NULLIF(TRIM(s.cells ->> s.status_id), ''), s.native_status) AS label
        FROM scoped s
        UNION ALL
        SELECT s.id, 'prioridade',
               COALESCE(NULLIF(TRIM(s.cells ->> s.priority_id), ''), s.native_priority)
        FROM scoped s
        UNION ALL
        SELECT s.id, 'indicador', NULLIF(TRIM(s.cells ->> s.indicador_id), '')
        FROM scoped s
        UNION ALL
        SELECT s.id, 'unidade',
               COALESCE(NULLIF(TRIM(s.cells ->> s.unidade_id), ''), NULLIF(s.unit_name, ''))
        FROM scoped s
        UNION ALL
        SELECT s.id, 'responsavel',
               COALESCE(NULLIF(TRIM(s.cells ->> s.responsavel_id), ''), NULLIF(s.responsible_name, ''))
        FROM scoped s
      ),
      counted AS (
        SELECT bucket, label, COUNT(*)::int AS cnt,
               ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY COUNT(*) DESC) AS rn
        FROM labeled
        WHERE label IS NOT NULL AND TRIM(label) <> ''
        GROUP BY bucket, label
      )
      SELECT bucket, label, cnt FROM counted WHERE rn <= 40
    `;

    return mapWorkbookAnalytics(kpiRows[0], groupRows);
  }

  getMembershipSheetCharts(membershipId: string) {
    return this.prisma.membership.findUnique({
      where: { id: membershipId },
      select: { id: true, sheetCharts: true },
    });
  }

  updateMembershipSheetCharts(membershipId: string, sheetCharts: Record<string, unknown>) {
    return this.prisma.membership.update({
      where: { id: membershipId },
      data: { sheetCharts: sheetCharts as Prisma.InputJsonValue },
    });
  }

  async bulkUpsertSheetRows(
    tenantId: string,
    actionPlanId: string,
    rows: Array<{
      id?: string;
      title: string;
      description?: string;
      status?: ActionStatus;
      priority?: ActionPriority;
      dueDate?: string;
      responsibleId?: string;
      unitId?: string;
      values?: Record<string, unknown>;
    }>,
  ) {
    if (rows.length === 0) return;

    const columns = await this.prisma.actionColumn.findMany({
      where: { actionPlanId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const byKey = new Map<string, { id: string }>();
    for (const col of columns) {
      byKey.set(col.id, col);
      byKey.set(col.name, col);
    }

    await this.prisma.$transaction(
      async (tx) => {
        await setTransactionTenant(tx, tenantId);
        for (const input of rows) {
          const values = input.values ?? {};
          if (input.id) {
            const existing = await tx.actionPlanRow.findFirst({
              where: { id: input.id, actionPlanId },
              select: { id: true, cells: true },
            });
            if (existing) {
              await tx.actionPlanRow.update({
                where: { id: existing.id },
                data: {
                  deletedAt: null,
                  title: input.title,
                  description: input.description,
                  status: input.status,
                  priority: input.priority,
                  dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
                  responsibleId: input.responsibleId,
                  unitId: input.unitId,
                  cells: mergeCells(existing.cells, values, byKey),
                },
              });
              continue;
            }
          }

          await tx.actionPlanRow.create({
            data: {
              id: input.id,
              actionPlanId,
              title: input.title,
              description: input.description,
              status: input.status,
              priority: input.priority,
              dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
              responsibleId: input.responsibleId,
              unitId: input.unitId,
              cells: buildCells(values, byKey),
            },
          });
        }
      },
      { timeout: 60_000, maxWait: 8_000 },
    );
  }

  async getChartSeries(
    actionPlanId: string,
    tenantId: string,
    spec: UserChartSpec,
    scopeResponsibleId?: string,
  ): Promise<UserChartSlice[]> {
    const columns = await this.prisma.actionColumn.findMany({
      where: { actionPlanId, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const category = columns.find(
      (col) => col.name === spec.columnKey || col.id === spec.columnKey,
    );
    const nativeExpr =
      spec.columnKey === 'status'
        ? Prisma.sql`COALESCE(NULLIF(TRIM(r.cells ->> ${category?.id ?? ''}), ''), r.status::text)`
        : spec.columnKey === 'prioridade' || spec.columnKey === 'priority'
          ? Prisma.sql`COALESCE(NULLIF(TRIM(r.cells ->> ${category?.id ?? ''}), ''), r.priority::text)`
          : spec.columnKey === 'data_fim' || spec.columnKey === 'prazo'
            ? Prisma.sql`COALESCE(NULLIF(TRIM(r.cells ->> ${category?.id ?? ''}), ''), to_char(r.due_date, 'YYYY-MM-DD'))`
            : spec.columnKey === 'responsavel'
              ? Prisma.sql`COALESCE(NULLIF(TRIM(r.cells ->> ${category?.id ?? ''}), ''), NULLIF(r.responsible_name, ''))`
              : spec.columnKey === 'unidade'
                ? Prisma.sql`COALESCE(NULLIF(TRIM(r.cells ->> ${category?.id ?? ''}), ''), NULLIF(r.unit_name, ''))`
                : null;

    if (!category && !nativeExpr) return [];
    const categoryId = category?.id ?? '';
    const source = nativeExpr ?? Prisma.sql`NULLIF(TRIM(r.cells ->> ${categoryId}), '')`;
    const valueCol = spec.valueColumnKey
      ? columns.find((col) => col.name === spec.valueColumnKey || col.id === spec.valueColumnKey)
      : undefined;
    const valueId = valueCol?.id;
    const addValueSql =
      spec.aggregation === 'sum' && valueId
        ? Prisma.sql`CASE
            WHEN (r.cells ->> ${valueId}) ~ '^-?[0-9]+([.,][0-9]+)?$'
            THEN REPLACE(REPLACE(TRIM(r.cells ->> ${valueId}), ' ', ''), ',', '.')::numeric
            ELSE 1
          END`
        : Prisma.sql`1`;
    const scopeSql = scopeResponsibleId
      ? Prisma.sql`AND r.responsible_id = ${scopeResponsibleId}`
      : Prisma.sql``;

    if (spec.type === 'line') {
      const rows = await this.prisma.$queryRaw<Array<{ sort_key: string; value: number }>>`
        SELECT month_key AS sort_key, SUM(add_value)::float AS value
        FROM (
          SELECT
            LEFT(NULLIF(TRIM(${source}), ''), 7) AS month_key,
            ${addValueSql} AS add_value
          FROM action_plan_rows r
          INNER JOIN action_plans p ON p.id = r.action_plan_id
          WHERE r.action_plan_id = ${actionPlanId}
            AND p.tenant_id = ${tenantId}
            AND r.deleted_at IS NULL
            ${scopeSql}
            AND NULLIF(TRIM(${source}), '') ~ '^[0-9]{4}-[0-9]{2}'
        ) months
        WHERE month_key IS NOT NULL
        GROUP BY month_key
        ORDER BY month_key ASC
        LIMIT 36
      `;
      return rows.map((row) => ({
        sortKey: row.sort_key,
        label: row.sort_key,
        value: Number(row.value) || 0,
      }));
    }

    const rows = await this.prisma.$queryRaw<Array<{ label: string; value: number }>>`
      SELECT label, SUM(add_value)::float AS value
      FROM (
        SELECT
          COALESCE(NULLIF(TRIM(${source}), ''), 'Não informado') AS label,
          ${addValueSql} AS add_value
        FROM action_plan_rows r
        INNER JOIN action_plans p ON p.id = r.action_plan_id
        WHERE r.action_plan_id = ${actionPlanId}
          AND p.tenant_id = ${tenantId}
          AND r.deleted_at IS NULL
          ${scopeSql}
      ) labeled
      GROUP BY label
      ORDER BY value DESC
      LIMIT 12
    `;
    return rows.map((row) => ({
      label: row.label,
      value: Number(row.value) || 0,
    }));
  }
}

