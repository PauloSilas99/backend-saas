import { inject, injectable } from 'tsyringe';
import { Role } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import {
  canViewAllCompanyActions,
  isOperacional,
  isPlatformAdmin,
  isReadOnly,
} from '@shared/helpers/rbac';
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

    // Escopo pessoal: operacional só vê as próprias ações; gestor/gerente podem filtrar
    const responsibleScope = isOperacional(actor)
      ? actor.id
      : query.assigneeId;

    // Para agenda "pessoal" padrão, gerente/gestor sem filtro vê ações atribuídas a si + sem responsável
    // e também pode ver todas se quiser (canViewAll). Preferência: se assigneeId não veio e é manager,
    // inclui ações do próprio usuário + todas do tenant? Product said calendar is personal.
    // → default: sempre foca no usuário logado (suas ações), managers podem passar assigneeId.
    const actionResponsibleId =
      responsibleScope ??
      (canViewAllCompanyActions(actor) && query.assigneeId
        ? query.assigneeId
        : actor.id);

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

    type ActionCalendarItem = {
      source: 'action';
      id: string;
      actionRowId: string;
      title: string;
      description: string | null;
      status: string;
      priority: string | null;
      baseDueDate: Date | null;
      startsAt: Date;
      endsAt: Date | null;
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

    const actionItems: ActionCalendarItem[] = [];

    for (const row of actionRows) {
      const overlay = overlayByRow.get(row.id) ?? null;
      if (overlay?.hidden) continue;

      const baseDueDate = row.dueDate;
      const startsAt = overlay?.displayStartsAt ?? baseDueDate;
      if (!startsAt) continue;
      if (startsAt < from || startsAt > to) continue;

      actionItems.push({
        source: 'action',
        id: row.id,
        actionRowId: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        baseDueDate,
        startsAt,
        endsAt: overlay?.displayEndsAt ?? null,
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
        responsibleName: row.responsibleName,
        responsible: row.responsible,
        unitName: row.unitName,
        actionPlan: row.actionPlan,
      });
    }

    // Overlays que remarcariam ações cuja baseDueDate está fora do range
    for (const overlay of overlays) {
      if (
        overlay.hidden ||
        !overlay.displayStartsAt ||
        overlay.displayStartsAt < from ||
        overlay.displayStartsAt > to ||
        actionItems.some((i) => i.actionRowId === overlay.actionRowId)
      ) {
        continue;
      }
      const row = await this.calendarRepository.findActionRow(overlay.actionRowId, actor.tenantId);
      if (!row) continue;
      if (actionResponsibleId && row.responsibleId !== actionResponsibleId) continue;

      actionItems.push({
        source: 'action',
        id: row.id,
        actionRowId: row.id,
        title: row.title,
        description: null,
        status: row.status,
        priority: null,
        baseDueDate: row.dueDate,
        startsAt: overlay.displayStartsAt,
        endsAt: overlay.displayEndsAt ?? null,
        hasPersonalOverride: true,
        overlay: {
          id: overlay.id,
          displayStartsAt: overlay.displayStartsAt,
          displayEndsAt: overlay.displayEndsAt,
          hidden: overlay.hidden,
          note: overlay.note,
          color: overlay.color,
        },
        responsibleId: row.responsibleId,
        responsibleName: null,
        responsible: null,
        unitName: null,
        actionPlan: null,
      });
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

    const items = [...actionItems, ...personalItems].sort(
      (a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime(),
    );

    return {
      items,
      overrides,
      meta: {
        from: query.from,
        to: query.to,
        note: 'Itens source=action usam dueDate da base; overlay pessoal não altera a planilha.',
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
