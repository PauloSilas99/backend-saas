import { inject, injectable } from 'tsyringe';
import {
  ActionPriority,
  ActionStatus,
  CalendarActivityStatus,
  CalendarOverrideType,
  ColumnFieldType,
  ColumnSemanticRole,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { CalendarRangeQuery } from './calendar.schemas';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';
import { cellsToNamedFieldValues } from '@modules/action-plans/row-cells';

@injectable()
export class CalendarRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listActivities(
    tenantId: string,
    query: CalendarRangeQuery,
    scopeAssigneeId?: string,
  ) {
    return this.prisma.calendarActivity.findMany({
      where: {
        tenantId,
        deletedAt: null,
        startsAt: {
          gte: new Date(query.from),
          lte: new Date(query.to),
        },
        ...(query.status ? { status: query.status } : {}),
        ...(scopeAssigneeId
          ? { assigneeId: scopeAssigneeId }
          : query.assigneeId
            ? { assigneeId: query.assigneeId }
            : {}),
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  findActivity(id: string, tenantId: string) {
    return this.prisma.calendarActivity.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  createActivity(data: {
    tenantId: string;
    createdById: string;
    title: string;
    description?: string;
    startsAt: Date;
    endsAt?: Date;
    allDay?: boolean;
    status?: CalendarActivityStatus;
    assigneeId?: string | null;
    location?: string;
    color?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.calendarActivity.create({
      data: {
        tenantId: data.tenantId,
        createdById: data.createdById,
        title: data.title,
        description: data.description,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        allDay: data.allDay ?? false,
        status: data.status,
        assigneeId: data.assigneeId ?? undefined,
        location: data.location,
        color: data.color,
        metadata: data.metadata,
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  updateActivity(id: string, data: Prisma.CalendarActivityUpdateInput) {
    return this.prisma.calendarActivity.update({
      where: { id },
      data,
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  softDeleteActivity(id: string) {
    return this.prisma.calendarActivity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  listOverrides(tenantId: string, from?: string, to?: string) {
    return this.prisma.calendarOverride.findMany({
      where: {
        tenantId,
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  upsertOverride(data: {
    tenantId: string;
    createdById: string;
    date: Date;
    type: CalendarOverrideType;
    title?: string | null;
    note?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.calendarOverride.upsert({
      where: {
        tenantId_date: { tenantId: data.tenantId, date: data.date },
      },
      create: {
        tenantId: data.tenantId,
        createdById: data.createdById,
        date: data.date,
        type: data.type,
        title: data.title,
        note: data.note,
        metadata: data.metadata,
      },
      update: {
        type: data.type,
        title: data.title,
        note: data.note,
        metadata: data.metadata,
      },
    });
  }

  deleteOverride(tenantId: string, date: Date) {
    return this.prisma.calendarOverride.deleteMany({
      where: { tenantId, date },
    });
  }

  private static readonly DATE_COLUMN_NAMES = [
    'data_ocorrencia',
    'data_inicio',
    'data_fim',
    'prazo',
    'data_criacao',
    'data_verificacao',
    'data_prox_verificacao',
    'data_conclusao',
  ];

  private actionRowCalendarSelect() {
    return {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      responsibleId: true,
      responsibleName: true,
      unitName: true,
      actionPlan: { select: { id: true, title: true } },
      responsible: { select: { id: true, name: true, email: true } },
      cells: true,
    } as const;
  }

  /**
   * Ações da base no período visível. Filtra data no SQL para não vazar a planilha.
   */
  async listActionRowsForCalendar(
    tenantId: string,
    from: Date,
    to: Date,
    responsibleId?: string,
  ) {
    const fromYmd = from.toISOString().slice(0, 10);
    const toYmd = to.toISOString().slice(0, 10);
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT r.id
      FROM action_plan_rows r
      INNER JOIN action_plans p ON p.id = r.action_plan_id
      WHERE p.tenant_id = ${tenantId}
        AND r.deleted_at IS NULL
        AND (${responsibleId ?? null}::text IS NULL OR r.responsible_id = ${responsibleId ?? null}::text)
        AND (
          (r.due_date >= ${from} AND r.due_date <= ${to})
          OR EXISTS (
            SELECT 1
            FROM action_columns c
            WHERE c.action_plan_id = r.action_plan_id
              AND c.deleted_at IS NULL
              AND (
                c.field_type = 'DATE'::"ColumnFieldType"
                OR c.semantic_role = 'DUE_DATE'::"ColumnSemanticRole"
                OR c.name IN (
                  'data_ocorrencia', 'data_inicio', 'data_fim', 'prazo',
                  'data_criacao', 'data_verificacao', 'data_prox_verificacao', 'data_conclusao'
                )
                OR c.name LIKE 'prazo%'
                OR c.name LIKE 'data_%'
              )
              AND jsonb_typeof(r.cells -> c.id::text) = 'string'
              AND (r.cells ->> c.id::text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
              AND LEFT(r.cells ->> c.id::text, 10) >= ${fromYmd}
              AND LEFT(r.cells ->> c.id::text, 10) <= ${toYmd}
          )
        )
      ORDER BY r.due_date ASC NULLS LAST
      LIMIT ${PRODUCT_LIMITS.calendarMaxEvents}
    `;
    if (ids.length === 0) return [];
    const rows = await this.prisma.actionPlanRow.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: this.actionRowCalendarSelect(),
      orderBy: { dueDate: 'asc' },
    });
    return this.withCalendarFieldValues(rows, tenantId);
  }

  findActionRow(id: string, tenantId: string) {
    return this.prisma.actionPlanRow.findFirst({
      where: { id, deletedAt: null, actionPlan: { tenantId } },
      select: {
        id: true,
        title: true,
        dueDate: true,
        responsibleId: true,
        status: true,
      },
    });
  }

  async findActionRowsByIds(ids: string[], tenantId: string) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.actionPlanRow.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        actionPlan: { tenantId },
      },
      select: this.actionRowCalendarSelect(),
    });
    return this.withCalendarFieldValues(rows, tenantId);
  }

  private async withCalendarFieldValues<
    T extends { cells: Prisma.JsonValue },
  >(rows: T[], tenantId: string) {
    if (rows.length === 0) return [];
    const columns = await this.prisma.actionColumn.findMany({
      where: {
        deletedAt: null,
        actionPlan: { tenantId },
        OR: [
          { fieldType: ColumnFieldType.DATE },
          { semanticRole: ColumnSemanticRole.DUE_DATE },
          { name: { in: CalendarRepository.DATE_COLUMN_NAMES } },
          { name: { startsWith: 'prazo' } },
          { name: { startsWith: 'data_' } },
        ],
      },
      select: { id: true, name: true },
    });
    return rows.map((row) => {
      const { cells, ...rest } = row;
      return {
        ...rest,
        fieldValues: cellsToNamedFieldValues(cells, columns),
      };
    });
  }

  listOverlaysForUser(tenantId: string, userId: string, actionRowIds?: string[]) {
    return this.prisma.calendarActionOverlay.findMany({
      where: {
        tenantId,
        userId,
        ...(actionRowIds ? { actionRowId: { in: actionRowIds } } : {}),
      },
    });
  }

  findOverlay(userId: string, actionRowId: string) {
    return this.prisma.calendarActionOverlay.findUnique({
      where: { userId_actionRowId: { userId, actionRowId } },
    });
  }

  upsertActionOverlay(data: {
    tenantId: string;
    userId: string;
    actionRowId: string;
    displayStartsAt?: Date | null;
    displayEndsAt?: Date | null;
    hidden?: boolean;
    note?: string | null;
    color?: string | null;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.calendarActionOverlay.upsert({
      where: {
        userId_actionRowId: {
          userId: data.userId,
          actionRowId: data.actionRowId,
        },
      },
      create: {
        tenantId: data.tenantId,
        userId: data.userId,
        actionRowId: data.actionRowId,
        displayStartsAt: data.displayStartsAt ?? undefined,
        displayEndsAt: data.displayEndsAt ?? undefined,
        hidden: data.hidden ?? false,
        note: data.note,
        color: data.color,
        metadata: data.metadata,
      },
      update: {
        displayStartsAt: data.displayStartsAt === undefined ? undefined : data.displayStartsAt,
        displayEndsAt: data.displayEndsAt === undefined ? undefined : data.displayEndsAt,
        hidden: data.hidden,
        note: data.note,
        color: data.color,
        metadata: data.metadata,
      },
    });
  }

  deleteActionOverlay(userId: string, actionRowId: string) {
    return this.prisma.calendarActionOverlay.deleteMany({
      where: { userId, actionRowId },
    });
  }
}
