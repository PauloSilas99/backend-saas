import { inject, injectable } from 'tsyringe';
import { ColumnHistoryAction } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import { canManageColumns, isPlatformAdmin } from '@shared/helpers/rbac';
import { ActionPlansRepository } from '@modules/action-plans/action-plans.repository';
import { ColumnsRepository } from './columns.repository';
import {
  CreateColumnInput,
  DeleteColumnInput,
  UpdateColumnInput,
} from './columns.schemas';

@injectable()
export class ColumnsService {
  constructor(
    @inject(ColumnsRepository) private readonly columnsRepository: ColumnsRepository,
    @inject(ActionPlansRepository) private readonly plansRepository: ActionPlansRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private async resolvePlanId(actor: AuthUser, actionPlanId?: string) {
    if (actionPlanId) {
      const plan = await this.plansRepository.findPlanMeta(actionPlanId, actor.tenantId);
      if (!plan) throw new NotFoundError('Plano de ação não encontrado');
      return plan.id;
    }
    const primary = await this.plansRepository.findPrimaryPlan(actor.tenantId);
    if (!primary) throw new NotFoundError('Nenhum workbook nesta empresa');
    return primary.id;
  }

  async list(actor: AuthUser, includeDeleted = false, actionPlanId?: string) {
    this.assertTenantAccess(actor);
    const planId = await this.resolvePlanId(actor, actionPlanId);
    if (includeDeleted) {
      if (!canManageColumns(actor)) throw new ForbiddenError();
      return this.columnsRepository.listIncludingDeleted(planId);
    }
    return this.columnsRepository.listActive(planId);
  }

  async create(actor: AuthUser, input: CreateColumnInput) {
    this.assertTenantAccess(actor);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const planId = await this.resolvePlanId(actor, input.actionPlanId);

    try {
      const column = await this.columnsRepository.create(actor.tenantId, planId, input);
      await this.columnsRepository.addHistory({
        columnId: column.id,
        actorId: actor.id,
        action: ColumnHistoryAction.CREATED,
        snapshot: column,
      });
      await this.auditService.log({
        tenantId: actor.tenantId,
        userId: actor.id,
        action: 'columns.create',
        resource: 'action_column',
        resourceId: column.id,
      });
      return column;
    } catch {
      throw new ValidationError('Não foi possível criar a coluna (nome duplicado?)');
    }
  }

  async update(actor: AuthUser, id: string, input: UpdateColumnInput) {
    this.assertTenantAccess(actor);
    if (!canManageColumns(actor)) throw new ForbiddenError();

    const existing = await this.columnsRepository.findById(id, actor.tenantId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundError('Coluna não encontrada');
    }

    const updated = await this.columnsRepository.update(id, {
      label: input.label,
      required: input.required,
      options: input.options,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      semanticRole: input.semanticRole,
    });

    await this.columnsRepository.addHistory({
      columnId: id,
      actorId: actor.id,
      action: ColumnHistoryAction.UPDATED,
      snapshot: updated,
    });

    return updated;
  }

  async remove(actor: AuthUser, id: string, input: DeleteColumnInput) {
    this.assertTenantAccess(actor);
    if (!canManageColumns(actor)) throw new ForbiddenError();

    const existing = await this.columnsRepository.findById(id, actor.tenantId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundError('Coluna não encontrada');
    }

    const deleted = await this.columnsRepository.softDelete(id, actor.id, input.reason);
    await this.columnsRepository.addHistory({
      columnId: id,
      actorId: actor.id,
      action: ColumnHistoryAction.DELETED,
      snapshot: {
        ...deleted,
        deleteReason: input.reason ?? null,
      },
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'columns.delete',
      resource: 'action_column',
      resourceId: id,
      metadata: { reason: input.reason },
    });

    return deleted;
  }

  async history(actor: AuthUser, id: string) {
    this.assertTenantAccess(actor);
    if (!canManageColumns(actor)) throw new ForbiddenError();
    const existing = await this.columnsRepository.findById(id, actor.tenantId);
    if (!existing) throw new NotFoundError('Coluna não encontrada');
    return this.columnsRepository.listHistory(id);
  }

  private assertTenantAccess(actor: AuthUser) {
    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError(
        'Admin da plataforma não acessa colunas operacionais das empresas',
      );
    }
  }
}
