import { inject, injectable } from 'tsyringe';
import { ForbiddenError, NotFoundError } from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import {
  canEditAnyAction,
  isOperacional,
  isPlatformAdmin,
} from '@shared/helpers/rbac';
import { RisksRepository } from './risks.repository';
import { CreateRiskInput, ListRisksQuery, UpdateRiskInput } from './risks.schemas';
import { CreateControlInput, UpdateControlInput } from './controls.schemas';

@injectable()
export class RisksService {
  constructor(
    @inject(RisksRepository) private readonly risksRepository: RisksRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthUser, query: ListRisksQuery) {
    this.assertTenantAccess(actor);
    const ownerScope = isOperacional(actor) ? actor.id : undefined;
    const { items, total } = await this.risksRepository.list(
      actor.tenantId,
      query,
      ownerScope,
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
    this.assertTenantAccess(actor);
    const risk = await this.risksRepository.findById(id, actor.tenantId);
    if (!risk) throw new NotFoundError('Risco não encontrado');
    if (isOperacional(actor) && risk.ownerId !== actor.id) {
      throw new ForbiddenError();
    }
    return risk;
  }

  async create(actor: AuthUser, input: CreateRiskInput) {
    this.assertTenantAccess(actor);
    if (!canEditAnyAction(actor)) throw new ForbiddenError();

    const risk = await this.risksRepository.create({
      tenant: { connect: { id: actor.tenantId } },
      title: input.title,
      description: input.description,
      probability: input.probability,
      impact: input.impact,
      severity: input.severity,
      status: input.status,
      mitigationPlan: input.mitigationPlan,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      owner: input.ownerId ? { connect: { id: input.ownerId } } : undefined,
      actionRow: input.actionRowId ? { connect: { id: input.actionRowId } } : undefined,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'risks.create',
      resource: 'risk',
      resourceId: risk.id,
    });

    return risk;
  }

  async update(actor: AuthUser, id: string, input: UpdateRiskInput) {
    this.assertTenantAccess(actor);
    if (!canEditAnyAction(actor)) throw new ForbiddenError();

    const existing = await this.risksRepository.findById(id, actor.tenantId);
    if (!existing) throw new NotFoundError('Risco não encontrado');

    return this.risksRepository.update(id, {
      title: input.title,
      description: input.description,
      probability: input.probability,
      impact: input.impact,
      severity: input.severity,
      status: input.status,
      mitigationPlan: input.mitigationPlan,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      owner: input.ownerId ? { connect: { id: input.ownerId } } : undefined,
      actionRow: input.actionRowId ? { connect: { id: input.actionRowId } } : undefined,
    });
  }

  async remove(actor: AuthUser, id: string) {
    this.assertTenantAccess(actor);
    if (!canEditAnyAction(actor)) throw new ForbiddenError();
    const existing = await this.risksRepository.findById(id, actor.tenantId);
    if (!existing) throw new NotFoundError('Risco não encontrado');
    return this.risksRepository.softDelete(id);
  }

  async stats(actor: AuthUser) {
    this.assertTenantAccess(actor);
    const grouped = await this.risksRepository.stats(actor.tenantId);
    return grouped.map((g) => ({ status: g.status, total: g._count._all }));
  }

  async matrix(actor: AuthUser) {
    this.assertTenantAccess(actor);
    const grouped = await this.risksRepository.matrix(actor.tenantId);
    return grouped.map((g) => ({
      probability: g.probability,
      impact: g.impact,
      total: g._count._all,
    }));
  }

  async listControls(actor: AuthUser, riskId: string) {
    await this.getById(actor, riskId);
    return this.risksRepository.listControls(riskId);
  }

  async createControl(actor: AuthUser, riskId: string, input: CreateControlInput) {
    await this.getById(actor, riskId);
    if (!canEditAnyAction(actor)) throw new ForbiddenError();
    return this.risksRepository.createControl({
      riskId,
      title: input.title,
      description: input.description,
      status: input.status,
      responsibleId: input.responsibleId,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      evidence: input.evidence,
    });
  }

  async updateControl(
    actor: AuthUser,
    riskId: string,
    controlId: string,
    input: UpdateControlInput,
  ) {
    await this.getById(actor, riskId);
    if (!canEditAnyAction(actor)) throw new ForbiddenError();
    const existing = await this.risksRepository.findControl(controlId, riskId);
    if (!existing) throw new NotFoundError('Controle não encontrado');

    return this.risksRepository.updateControl(controlId, {
      title: input.title,
      description: input.description,
      status: input.status,
      evidence: input.evidence,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      completedAt:
        input.completedAt === null
          ? null
          : input.completedAt
            ? new Date(input.completedAt)
            : undefined,
      responsible: input.responsibleId
        ? { connect: { id: input.responsibleId } }
        : undefined,
    });
  }

  async removeControl(actor: AuthUser, riskId: string, controlId: string) {
    await this.getById(actor, riskId);
    if (!canEditAnyAction(actor)) throw new ForbiddenError();
    const existing = await this.risksRepository.findControl(controlId, riskId);
    if (!existing) throw new NotFoundError('Controle não encontrado');
    await this.risksRepository.deleteControl(controlId);
    return { id: controlId, deleted: true };
  }

  private assertTenantAccess(actor: AuthUser) {
    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError('Admin da plataforma não acessa riscos das empresas');
    }
  }
}
