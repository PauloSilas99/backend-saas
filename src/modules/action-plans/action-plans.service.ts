import { inject, injectable } from 'tsyringe';
import { ActionStatus, Role } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import {
  canApproveActions,
  canCreateActions,
  canDeleteOrDuplicateAction,
  canEditAnyAction,
  canViewAllCompanyActions,
  isOperacional,
  isPlatformAdmin,
  resolveCompletionTargetStatus,
} from '@shared/helpers/rbac';
import { TenantPolicyService } from '@shared/policies/tenant-policy.service';
import { ActionPlansRepository } from './action-plans.repository';
import {
  ApproveActionInput,
  CreateActionPlanInput,
  CreateActionRowInput,
  ListActionsQuery,
  RejectActionInput,
  TransitionActionInput,
  UpdateActionRowInput,
} from './action-plans.schemas';

@injectable()
export class ActionPlansService {
  constructor(
    @inject(ActionPlansRepository)
    private readonly actionPlansRepository: ActionPlansRepository,
    @inject(TenantPolicyService)
    private readonly tenantPolicyService: TenantPolicyService,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async listPlans(actor: AuthUser) {
    this.assertNotPlatformAdminContent(actor);
    if (isOperacional(actor)) {
      return this.actionPlansRepository.listRowsForUser(actor.tenantId, actor.id);
    }
    return this.actionPlansRepository.listPlans(actor.tenantId);
  }

  async listActions(actor: AuthUser, query: ListActionsQuery) {
    this.assertNotPlatformAdminContent(actor);
    const scopeResponsibleId = isOperacional(actor) ? actor.id : undefined;
    const { items, total } = await this.actionPlansRepository.listActions(
      actor.tenantId,
      query,
      scopeResponsibleId,
    );
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async getById(actor: AuthUser, id: string) {
    this.assertNotPlatformAdminContent(actor);
    const plan = await this.actionPlansRepository.findPlan(id, actor.tenantId);
    if (!plan) throw new NotFoundError('Plano de ação não encontrado');

    if (isOperacional(actor)) {
      return {
        ...plan,
        rows: plan.rows.filter((r) => r.responsibleId === actor.id),
      };
    }

    return plan;
  }

  async getRow(actor: AuthUser, rowId: string) {
    this.assertNotPlatformAdminContent(actor);
    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');
    if (isOperacional(actor) && row.responsibleId !== actor.id) {
      throw new ForbiddenError('Operacional só acessa as próprias ações');
    }
    return row;
  }

  async create(actor: AuthUser, input: CreateActionPlanInput) {
    this.assertNotPlatformAdminContent(actor);
    if (!canCreateActions(actor)) {
      throw new ForbiddenError('Sem permissão para criar planos de ação');
    }

    const plan = await this.actionPlansRepository.createPlan({
      tenantId: actor.tenantId,
      ownerId: actor.id,
      ...input,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'action_plans.create',
      resource: 'action_plan',
      resourceId: plan.id,
    });

    return plan;
  }

  async addRow(actor: AuthUser, planId: string, input: CreateActionRowInput) {
    this.assertNotPlatformAdminContent(actor);
    if (!canCreateActions(actor)) {
      throw new ForbiddenError('Sem permissão para criar ações');
    }

    const plan = await this.actionPlansRepository.findPlan(planId, actor.tenantId);
    if (!plan) throw new NotFoundError('Plano de ação não encontrado');

    const row = await this.actionPlansRepository.createRow({
      actionPlanId: planId,
      title: input.title,
      description: input.description,
      unitId: input.unitId,
      responsibleId: input.responsibleId,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      externalKey: input.externalKey,
    });

    const values = { ...(input.customFields ?? {}), ...(input.values ?? {}) };
    if (Object.keys(values).length > 0) {
      await this.actionPlansRepository.upsertFieldValues(row.id, actor.tenantId, values);
    }

    await this.actionPlansRepository.addHistory({
      actionRowId: row.id,
      actorId: actor.id,
      toStatus: row.status,
      comment: 'Ação criada',
    });

    return this.actionPlansRepository.findRow(row.id, actor.tenantId);
  }

  async updateRow(actor: AuthUser, rowId: string, input: UpdateActionRowInput) {
    this.assertNotPlatformAdminContent(actor);
    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');

    if (isOperacional(actor)) {
      if (row.responsibleId !== actor.id) {
        throw new ForbiddenError('Operacional só atualiza as próprias ações');
      }
      if (input.status && input.status !== ActionStatus.IN_PROGRESS) {
        throw new ForbiddenError(
          'Operacional só pode iniciar a ação. Use solicitar conclusão para finalizar.',
        );
      }
      const updated = await this.actionPlansRepository.updateRow(rowId, {
        status: ActionStatus.IN_PROGRESS,
      });
      await this.actionPlansRepository.addHistory({
        actionRowId: rowId,
        actorId: actor.id,
        fromStatus: row.status,
        toStatus: ActionStatus.IN_PROGRESS,
        comment: input.comment ?? 'Execução iniciada',
      });
      return updated;
    }

    if (!canEditAnyAction(actor)) {
      throw new ForbiddenError();
    }

    if (input.status === ActionStatus.COMPLETED) {
      return this.requestOrComplete(actor, rowId, { comment: input.comment });
    }

    const updated = await this.actionPlansRepository.updateRow(rowId, {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      unit: input.unitId ? { connect: { id: input.unitId } } : undefined,
      responsible: input.responsibleId
        ? { connect: { id: input.responsibleId } }
        : undefined,
    });

    const values = { ...(input.customFields ?? {}), ...(input.values ?? {}) };
    if (Object.keys(values).length > 0) {
      await this.actionPlansRepository.upsertFieldValues(rowId, actor.tenantId, values);
    }

    if (input.status && input.status !== row.status) {
      await this.actionPlansRepository.addHistory({
        actionRowId: rowId,
        actorId: actor.id,
        fromStatus: row.status,
        toStatus: input.status,
        comment: input.comment,
      });
    }

    return this.actionPlansRepository.findRow(rowId, actor.tenantId);
  }

  async requestCompletion(actor: AuthUser, rowId: string, input: TransitionActionInput) {
    this.assertNotPlatformAdminContent(actor);
    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');

    if (isOperacional(actor) && row.responsibleId !== actor.id) {
      throw new ForbiddenError();
    }
    if (!isOperacional(actor) && !canEditAnyAction(actor)) {
      throw new ForbiddenError();
    }

    return this.requestOrComplete(actor, rowId, input);
  }

  async approve(actor: AuthUser, rowId: string, input: ApproveActionInput) {
    this.assertNotPlatformAdminContent(actor);
    const hasGestor = await this.tenantPolicyService.tenantHasActiveGestor(actor.tenantId);
    if (!canApproveActions(actor, hasGestor)) {
      throw new ForbiddenError('Sem permissão para aprovar ações');
    }

    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');
    if (row.status !== ActionStatus.WAITING_APPROVAL && row.status !== ActionStatus.IN_PROGRESS) {
      throw new ValidationError('Ação não está aguardando aprovação');
    }

    const updated = await this.actionPlansRepository.updateRow(rowId, {
      status: ActionStatus.COMPLETED,
      completedAt: new Date(),
    });

    await this.actionPlansRepository.addHistory({
      actionRowId: rowId,
      actorId: actor.id,
      fromStatus: row.status,
      toStatus: ActionStatus.COMPLETED,
      comment: input.comment ?? 'Ação aprovada',
    });

    return updated;
  }

  async reject(actor: AuthUser, rowId: string, input: RejectActionInput) {
    this.assertNotPlatformAdminContent(actor);
    const hasGestor = await this.tenantPolicyService.tenantHasActiveGestor(actor.tenantId);
    if (!canApproveActions(actor, hasGestor)) {
      throw new ForbiddenError('Sem permissão para rejeitar ações');
    }

    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');
    if (row.status !== ActionStatus.WAITING_APPROVAL) {
      throw new ValidationError('Ação não está aguardando aprovação');
    }

    const updated = await this.actionPlansRepository.updateRow(rowId, {
      status: ActionStatus.REJECTED,
      completedAt: null,
    });

    await this.actionPlansRepository.addHistory({
      actionRowId: rowId,
      actorId: actor.id,
      fromStatus: row.status,
      toStatus: ActionStatus.REJECTED,
      comment: input.comment,
    });

    return updated;
  }

  async resolve(
    actor: AuthUser,
    rowId: string,
    input: import('./action-plans.schemas').ResolveActionInput,
  ) {
    this.assertNotPlatformAdminContent(actor);
    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');

    if (isOperacional(actor) && row.responsibleId !== actor.id) {
      throw new ForbiddenError();
    }
    if (!isOperacional(actor) && !canEditAnyAction(actor) && !canApproveActions(actor, false)) {
      throw new ForbiddenError();
    }

    const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
    const updated = await this.actionPlansRepository.updateRow(rowId, {
      status: ActionStatus.COMPLETED,
      completedAt,
      metadata: {
        ...((row.metadata as object) ?? {}),
        evidence: input.evidence,
        resolvedAt: completedAt.toISOString(),
      },
    });

    await this.actionPlansRepository.addHistory({
      actionRowId: rowId,
      actorId: actor.id,
      fromStatus: row.status,
      toStatus: ActionStatus.COMPLETED,
      comment: input.comment ?? 'Ação resolvida',
      metadata: { evidence: input.evidence },
    });

    return updated;
  }

  async duplicate(actor: AuthUser, rowId: string) {
    this.assertNotPlatformAdminContent(actor);
    if (!canDeleteOrDuplicateAction(actor)) {
      throw new ForbiddenError();
    }

    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');

    const copy = await this.actionPlansRepository.duplicateRow(rowId, {
      actionPlan: { connect: { id: row.actionPlanId } },
      title: `${row.title} (cópia)`,
      description: row.description,
      status: ActionStatus.PENDING,
      priority: row.priority,
      dueDate: row.dueDate,
      responsibleName: row.responsibleName,
      unitName: row.unitName,
      unit: row.unitId ? { connect: { id: row.unitId } } : undefined,
      responsible: row.responsibleId ? { connect: { id: row.responsibleId } } : undefined,
      externalKey: row.externalKey ? `${row.externalKey}-copy-${Date.now()}` : undefined,
    });

    await this.actionPlansRepository.addHistory({
      actionRowId: copy.id,
      actorId: actor.id,
      toStatus: ActionStatus.PENDING,
      comment: `Duplicada a partir de ${row.id}`,
      metadata: { sourceRowId: row.id },
    });

    return copy;
  }

  async remove(actor: AuthUser, rowId: string) {
    this.assertNotPlatformAdminContent(actor);
    if (!canDeleteOrDuplicateAction(actor)) {
      throw new ForbiddenError();
    }

    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');

    const deleted = await this.actionPlansRepository.softDeleteRow(rowId);
    await this.actionPlansRepository.addHistory({
      actionRowId: rowId,
      actorId: actor.id,
      fromStatus: row.status,
      comment: 'Ação excluída (soft delete)',
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'action_plans.row.delete',
      resource: 'action_plan_row',
      resourceId: rowId,
    });

    return deleted;
  }

  async calendar(actor: AuthUser, from: string, to: string) {
    this.assertNotPlatformAdminContent(actor);
    const responsibleId = isOperacional(actor) ? actor.id : undefined;
    if (!canViewAllCompanyActions(actor) && !isOperacional(actor)) {
      throw new ForbiddenError();
    }
    return this.actionPlansRepository.listCalendar(
      actor.tenantId,
      new Date(from),
      new Date(to),
      responsibleId,
    );
  }

  private async requestOrComplete(
    actor: AuthUser,
    rowId: string,
    input: TransitionActionInput,
  ) {
    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');

    const hasGestor = await this.tenantPolicyService.tenantHasActiveGestor(actor.tenantId);
    const target = resolveCompletionTargetStatus(actor, hasGestor) as ActionStatus;

    const updated = await this.actionPlansRepository.updateRow(rowId, {
      status: target,
      completedAt: target === ActionStatus.COMPLETED ? new Date() : null,
    });

    await this.actionPlansRepository.addHistory({
      actionRowId: rowId,
      actorId: actor.id,
      fromStatus: row.status,
      toStatus: target,
      comment:
        input.comment ??
        (target === ActionStatus.COMPLETED
          ? 'Ação concluída'
          : 'Conclusão solicitada — aguardando aprovação do gestor'),
      metadata: { tenantHasGestor: hasGestor, actorRole: actor.role },
    });

    return updated;
  }

  private assertNotPlatformAdminContent(actor: AuthUser) {
    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError(
        'Admin da plataforma não acessa conteúdo operacional das empresas',
      );
    }
  }
}
