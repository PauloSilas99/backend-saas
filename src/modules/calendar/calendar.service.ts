import { inject, injectable } from 'tsyringe';
import { Prisma, Role } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import { isOperacional, isPlatformAdmin, isReadOnly } from '@shared/helpers/rbac';
import { CalendarRepository } from './calendar.repository';
import {
  CalendarRangeQuery,
  CreateActivityInput,
  PutOverridesInput,
  UpdateActivityInput,
  UpsertActionOverlayInput,
  UpsertOverrideInput,
} from './calendar.schemas';

@injectable()
export class CalendarService {
  constructor(
    @inject(CalendarRepository) private readonly calendarRepository: CalendarRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  /**
   * Agenda híbrida:
   * - items source=action → datas da base (planilha/ações) + overlay pessoal
   * - items source=personal → atividades livres do usuário
   * - overrides → dias bloqueados/notas (empresa)
   * Remarcar overlay NÃO altera ActionPlanRow.dueDate.
   */
  async getAgenda(actor: AuthUser, query: CalendarRangeQuery) {
    this.assertTenantAccess(actor);

    const from = new Date(query.from);
    const to = new Date(query.to);

    // Operacional: só as próprias ações. Gestor/gerente/leitor: todas, salvo assigneeId.
    const actionResponsibleId = isOperacional(actor)
      ? actor.id
      : query.assigneeId;

    const personalScope = isOperacional(actor) ? actor.id : query.assigneeId;

    const [actionRows, personalActivities, overrides, overlays] = await Promise.all([
      this.calendarRepository.listActionRowsForCalendar(
        actor.tenantId,
        from,
        to,
        actionResponsibleId,
      ),
      this.calendarRepository.listActivities(actor.tenantId, query, personalScope ?? actor.id),
      this.calendarRepository.listOverrides(
        actor.tenantId,
        query.from.slice(0, 10),
        query.to.slice(0, 10),
      ),
      this.calendarRepository.listOverlaysForUser(actor.tenantId, actor.id),
    ]);

    const overlayByRow = new Map(overlays.map((o) => [o.actionRowId, o]));

    type CalendarRow = (typeof actionRows)[number];

    type ActionCalendarItem = {
      source: 'action';
      id: string;
      actionRowId: string;
      title: string;
      description: string | null;
      status: string;
      priority: string | null;
      baseDueDate: Date | null;
      startsAt: Date | null;
      endsAt: Date | null;
      dates: {
        ocorrencia: Date | null;
        inicio: Date | null;
        prazo: Date | null;
      };
      registro: string | null;
      hasPersonalOverride: boolean;
      overlay: {
        id: string;
        displayStartsAt: Date | null;
        displayEndsAt: Date | null;
        hidden: boolean;
        note: string | null;
        color: string | null;
      } | null;
      responsibleId: string | null;
      responsibleName: string | null;
      responsible: { id: string; name: string; email: string } | null;
      unitName: string | null;
      actionPlan: { id: string; title: string } | null;
    };

    const toItem = (
      row: CalendarRow,
      overlay: (typeof overlays)[number] | null,
    ): ActionCalendarItem | null => {
      if (overlay?.hidden) return null;

      const values = fieldValuesToMap(row.fieldValues);
      const dates = {
        ocorrencia: parseDateLike(values.data_ocorrencia),
        inicio: parseDateLike(values.data_inicio),
        prazo:
          parseDateLike(values.data_fim) ??
          parseDateLike(values.prazo) ??
          row.dueDate,
      };
      const periodStart = overlay?.displayStartsAt ?? dates.inicio;
      const periodEnd = overlay?.displayEndsAt ?? dates.prazo;
      const visible = [dates.ocorrencia, periodStart, periodEnd];
      if (!visible.some((d) => d && d >= from && d <= to)) return null;

      return {
        source: 'action',
        id: row.id,
        actionRowId: row.id,
        title: (values.acao_corretiva || values.registro || row.title).trim() || row.title,
        description: row.description ?? values.descricao_fato ?? null,
        status: values.status || row.status,
        priority: row.priority,
        baseDueDate: row.dueDate,
        startsAt: periodStart ?? periodEnd ?? dates.ocorrencia,
        endsAt: periodEnd,
        dates,
        registro: values.registro?.trim() || null,
        hasPersonalOverride: Boolean(overlay?.displayStartsAt || overlay?.displayEndsAt),
        overlay: overlay
          ? {
              id: overlay.id,
              displayStartsAt: overlay.displayStartsAt,
              displayEndsAt: overlay.displayEndsAt,
              hidden: overlay.hidden,
              note: overlay.note,
              color: overlay.color,
            }
          : null,
        responsibleId: row.responsibleId,
        responsibleName: row.responsibleName ?? values.responsavel ?? null,
        responsible: row.responsible,
        unitName: row.unitName ?? values.unidade ?? null,
        actionPlan: row.actionPlan,
      };
    };

    const actionItems: ActionCalendarItem[] = [];
    const seen = new Set<string>();

    for (const row of actionRows) {
      const item = toItem(row, overlayByRow.get(row.id) ?? null);
      if (!item) continue;
      actionItems.push(item);
      seen.add(row.id);
    }

    const missingOverlayIds = overlays
      .filter((overlay) => {
        if (overlay.hidden || seen.has(overlay.actionRowId)) return false;
        const start = overlay.displayStartsAt;
        const end = overlay.displayEndsAt;
        return (
          (start != null && start >= from && start <= to) ||
          (end != null && end >= from && end <= to)
        );
      })
      .map((overlay) => overlay.actionRowId);

    const extraRows = await this.calendarRepository.findActionRowsByIds(
      missingOverlayIds,
      actor.tenantId,
    );

    for (const row of extraRows) {
      if (actionResponsibleId && row.responsibleId !== actionResponsibleId) continue;
      const item = toItem(row, overlayByRow.get(row.id) ?? null);
      if (!item) continue;
      actionItems.push(item);
    }

    const personalItems = personalActivities.map((a) => ({
      source: 'personal' as const,
      id: a.id,
      title: a.title,
      description: a.description,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      allDay: a.allDay,
      status: a.status,
      location: a.location,
      color: a.color,
      assigneeId: a.assigneeId,
      assignee: a.assignee,
      createdBy: a.createdBy,
    }));

    const items = [...actionItems, ...personalItems].sort((a, b) => {
      const aTime = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const bTime = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return aTime - bTime;
    });

    return {
      items,
      overrides,
      meta: {
        from: query.from,
        to: query.to,
        note: 'Itens source=action usam datas da planilha; overlay pessoal não altera a base.',
      },
    };
  }

  async listActivities(actor: AuthUser, query: CalendarRangeQuery) {
    this.assertTenantAccess(actor);
    const scopeAssigneeId = isOperacional(actor) ? actor.id : query.assigneeId ?? actor.id;
    return this.calendarRepository.listActivities(actor.tenantId, query, scopeAssigneeId);
  }

  async getActivity(actor: AuthUser, id: string) {
    this.assertTenantAccess(actor);
    const activity = await this.calendarRepository.findActivity(id, actor.tenantId);
    if (!activity) throw new NotFoundError('Atividade não encontrada');
    if (isOperacional(actor) && activity.assigneeId !== actor.id && activity.createdById !== actor.id) {
      throw new ForbiddenError();
    }
    return activity;
  }

  async createActivity(actor: AuthUser, input: CreateActivityInput) {
    this.assertTenantAccess(actor);
    if (isReadOnly(actor)) throw new ForbiddenError();
    this.assertDateRange(input.startsAt, input.endsAt);

    if (isOperacional(actor) && input.assigneeId && input.assigneeId !== actor.id) {
      throw new ForbiddenError('Operacional só agenda para si');
    }

    const activity = await this.calendarRepository.createActivity({
      tenantId: actor.tenantId,
      createdById: actor.id,
      title: input.title,
      description: input.description,
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      allDay: input.allDay,
      status: input.status,
      assigneeId: input.assigneeId ?? actor.id,
      location: input.location,
      color: input.color,
      metadata: input.metadata as object | undefined,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'calendar.activity.create',
      resource: 'calendar_activity',
      resourceId: activity.id,
    });

    return activity;
  }

  async updateActivity(actor: AuthUser, id: string, input: UpdateActivityInput) {
    this.assertTenantAccess(actor);
    if (isReadOnly(actor)) throw new ForbiddenError();

    const existing = await this.calendarRepository.findActivity(id, actor.tenantId);
    if (!existing) throw new NotFoundError('Atividade não encontrada');

    if (isOperacional(actor)) {
      if (existing.assigneeId !== actor.id && existing.createdById !== actor.id) {
        throw new ForbiddenError();
      }
      if (input.assigneeId && input.assigneeId !== actor.id) {
        throw new ForbiddenError();
      }
    }

    if (input.startsAt || input.endsAt) {
      this.assertDateRange(
        input.startsAt ?? existing.startsAt.toISOString(),
        input.endsAt ?? existing.endsAt?.toISOString(),
      );
    }

    const updated = await this.calendarRepository.updateActivity(id, {
      title: input.title,
      description: input.description,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      endsAt: input.endsAt === undefined ? undefined : input.endsAt ? new Date(input.endsAt) : null,
      allDay: input.allDay,
      status: input.status,
      location: input.location,
      color: input.color,
      metadata: input.metadata as object | undefined,
      assignee:
        input.assigneeId === null
          ? { disconnect: true }
          : input.assigneeId
            ? { connect: { id: input.assigneeId } }
            : undefined,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'calendar.activity.update',
      resource: 'calendar_activity',
      resourceId: id,
    });

    return updated;
  }

  async removeActivity(actor: AuthUser, id: string) {
    this.assertTenantAccess(actor);
    if (isReadOnly(actor)) throw new ForbiddenError();
    const existing = await this.calendarRepository.findActivity(id, actor.tenantId);
    if (!existing) throw new NotFoundError('Atividade não encontrada');
    if (isOperacional(actor) && existing.createdById !== actor.id && existing.assigneeId !== actor.id) {
      throw new ForbiddenError();
    }

    await this.calendarRepository.softDeleteActivity(id);
    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'calendar.activity.delete',
      resource: 'calendar_activity',
      resourceId: id,
    });
    return { id, deleted: true };
  }

  /**
   * Remarca / oculta ação no calendário pessoal.
   * Nunca altera ActionPlanRow.dueDate.
   */
  async upsertActionOverlay(
    actor: AuthUser,
    actionRowId: string,
    input: UpsertActionOverlayInput,
  ) {
    this.assertTenantAccess(actor);
    if (isReadOnly(actor)) throw new ForbiddenError();

    const row = await this.calendarRepository.findActionRow(actionRowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação da base não encontrada');

    if (isOperacional(actor) && row.responsibleId !== actor.id) {
      throw new ForbiddenError('Só pode remarcar ações atribuídas a você');
    }

    if (input.displayStartsAt && input.displayEndsAt) {
      this.assertDateRange(input.displayStartsAt, input.displayEndsAt);
    }

    const overlay = await this.calendarRepository.upsertActionOverlay({
      tenantId: actor.tenantId,
      userId: actor.id,
      actionRowId,
      displayStartsAt:
        input.displayStartsAt === undefined
          ? undefined
          : input.displayStartsAt
            ? new Date(input.displayStartsAt)
            : null,
      displayEndsAt:
        input.displayEndsAt === undefined
          ? undefined
          : input.displayEndsAt
            ? new Date(input.displayEndsAt)
            : null,
      hidden: input.hidden,
      note: input.note,
      color: input.color,
      metadata: input.metadata as object | undefined,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'calendar.action_overlay.upsert',
      resource: 'calendar_action_overlay',
      resourceId: overlay.id,
      metadata: {
        actionRowId,
        baseDueDate: row.dueDate,
        note: 'Overlay pessoal — base da planilha não foi alterada',
      },
    });

    return {
      ...overlay,
      baseDueDate: row.dueDate,
      writesToBase: false,
    };
  }

  async removeActionOverlay(actor: AuthUser, actionRowId: string) {
    this.assertTenantAccess(actor);
    if (isReadOnly(actor)) throw new ForbiddenError();
    await this.calendarRepository.deleteActionOverlay(actor.id, actionRowId);
    return { actionRowId, deleted: true, writesToBase: false };
  }

  async listOverrides(actor: AuthUser, from?: string, to?: string) {
    this.assertTenantAccess(actor);
    return this.calendarRepository.listOverrides(actor.tenantId, from, to);
  }

  async putOverrides(actor: AuthUser, input: PutOverridesInput) {
    this.assertTenantAccess(actor);
    if (isReadOnly(actor) || isOperacional(actor)) {
      throw new ForbiddenError('Apenas gerente/gestor gerencia overrides de dia');
    }
    if (actor.role !== Role.GERENTE && actor.role !== Role.GESTOR) {
      throw new ForbiddenError();
    }

    const results = [];
    for (const item of input.overrides) {
      results.push(await this.upsertOverride(actor, item));
    }
    return results;
  }

  async upsertOverride(actor: AuthUser, input: UpsertOverrideInput) {
    this.assertTenantAccess(actor);
    if (isReadOnly(actor) || isOperacional(actor)) {
      throw new ForbiddenError();
    }

    const date = new Date(`${input.date}T00:00:00.000Z`);
    const override = await this.calendarRepository.upsertOverride({
      tenantId: actor.tenantId,
      createdById: actor.id,
      date,
      type: input.type,
      title: input.title,
      note: input.note,
      metadata: input.metadata as object | undefined,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'calendar.override.upsert',
      resource: 'calendar_override',
      resourceId: override.id,
      metadata: { date: input.date },
    });

    return override;
  }

  async removeOverride(actor: AuthUser, date: string) {
    this.assertTenantAccess(actor);
    if (actor.role !== Role.GERENTE && actor.role !== Role.GESTOR) {
      throw new ForbiddenError();
    }
    const day = new Date(`${date}T00:00:00.000Z`);
    await this.calendarRepository.deleteOverride(actor.tenantId, day);
    return { date, deleted: true };
  }

  private assertTenantAccess(actor: AuthUser) {
    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError('Admin da plataforma não usa calendário da empresa');
    }
  }

  private assertDateRange(startsAt: string, endsAt?: string | null) {
    if (!endsAt) return;
    if (new Date(endsAt) < new Date(startsAt)) {
      throw new ValidationError('endsAt deve ser >= startsAt');
    }
  }
}

function jsonToString(value: Prisma.JsonValue | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function fieldValuesToMap(
  fieldValues: Array<{ value: Prisma.JsonValue | null; column: { name: string } }>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const fv of fieldValues) {
    values[fv.column.name] = jsonToString(fv.value);
  }
  return values;
}

function parseDateLike(raw: string | null | undefined): Date | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(`${v.slice(0, 10)}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    const d = new Date(
      `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}T12:00:00.000Z`,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
