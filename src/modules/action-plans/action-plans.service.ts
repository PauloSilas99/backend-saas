import { inject, injectable } from 'tsyringe';
import { Role } from '@prisma/client';
import { ForbiddenError, NotFoundError } from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import { ActionPlansRepository } from './action-plans.repository';
import {
  CreateActionPlanInput,
  CreateActionRowInput,
  UpdateActionRowInput,
} from './action-plans.schemas';

@injectable()
export class ActionPlansService {
  constructor(
    @inject(ActionPlansRepository)
    private readonly actionPlansRepository: ActionPlansRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthUser) {
    if (actor.role === Role.OPERACIONAL) {
      return this.actionPlansRepository.listRowsForUser(actor.tenantId, actor.id);
    }

    return this.actionPlansRepository.listPlans(actor.tenantId);
  }

  async getById(actor: AuthUser, id: string) {
    const plan = await this.actionPlansRepository.findPlan(id, actor.tenantId);
    if (!plan) throw new NotFoundError('Plano de ação não encontrado');

    if (actor.role === Role.OPERACIONAL) {
      return {
        ...plan,
        rows: plan.rows.filter((r) => r.responsibleId === actor.id),
      };
    }

    return plan;
  }

  async create(actor: AuthUser, input: CreateActionPlanInput) {
    if (actor.role === Role.OPERACIONAL) {
      throw new ForbiddenError('Operacional não cria planos de ação');
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
    if (actor.role === Role.OPERACIONAL) {
      throw new ForbiddenError();
    }

    const plan = await this.actionPlansRepository.findPlan(planId, actor.tenantId);
    if (!plan) throw new NotFoundError('Plano de ação não encontrado');

    return this.actionPlansRepository.createRow({
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
  }

  async updateRow(actor: AuthUser, rowId: string, input: UpdateActionRowInput) {
    const row = await this.actionPlansRepository.findRow(rowId, actor.tenantId);
    if (!row) throw new NotFoundError('Ação não encontrada');

    if (actor.role === Role.OPERACIONAL) {
      if (row.responsibleId !== actor.id) {
        throw new ForbiddenError('Operacional só atualiza as próprias ações');
      }
      // Operacional can only update status
      return this.actionPlansRepository.updateRow(rowId, {
        status: input.status,
        completedAt: input.status === 'COMPLETED' ? new Date() : undefined,
      });
    }

    return this.actionPlansRepository.updateRow(rowId, {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      unit: input.unitId ? { connect: { id: input.unitId } } : undefined,
      responsible: input.responsibleId
        ? { connect: { id: input.responsibleId } }
        : undefined,
      completedAt: input.status === 'COMPLETED' ? new Date() : undefined,
    });
  }
}
