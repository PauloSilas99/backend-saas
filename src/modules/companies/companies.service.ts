import { inject, injectable } from 'tsyringe';
import { Role } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import { isPlatformAdmin, isOperacional } from '@shared/helpers/rbac';
import { CompaniesRepository } from './companies.repository';
import {
  CreateCompanyInput,
  CreateUnitInput,
  UpdateCompanyInput,
} from './companies.schemas';

@injectable()
export class CompaniesService {
  constructor(
    @inject(CompaniesRepository) private readonly companiesRepository: CompaniesRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthUser) {
    if (isPlatformAdmin(actor)) {
      return this.companiesRepository.listAll();
    }

    const company = await this.companiesRepository.findById(actor.tenantId);
    if (!company) throw new NotFoundError('Empresa não encontrada');
    return [company];
  }

  async getById(actor: AuthUser, id: string) {
    if (!isPlatformAdmin(actor) && actor.tenantId !== id) {
      throw new ForbiddenError('Sem acesso a esta empresa');
    }

    const company = await this.companiesRepository.findById(id);
    if (!company) throw new NotFoundError('Empresa não encontrada');
    return company;
  }

  async create(actor: AuthUser, input: CreateCompanyInput) {
    if (!isPlatformAdmin(actor)) {
      throw new ForbiddenError('Apenas admin da plataforma cria empresas');
    }

    const existing = await this.companiesRepository.findBySlug(input.slug);
    if (existing) throw new ConflictError('Slug já em uso');

    const company = await this.companiesRepository.create(input);
    await this.auditService.log({
      tenantId: company.id,
      userId: actor.id,
      action: 'companies.create',
      resource: 'tenant',
      resourceId: company.id,
    });
    return company;
  }

  async update(actor: AuthUser, id: string, input: UpdateCompanyInput) {
    if (isOperacional(actor) || actor.role === Role.GESTOR) {
      throw new ForbiddenError();
    }

    if (actor.role === Role.GERENTE && actor.tenantId !== id) {
      throw new ForbiddenError('Gerente só atualiza a própria empresa');
    }

    if (!isPlatformAdmin(actor) && input.isActive !== undefined) {
      throw new ForbiddenError('Apenas admin da plataforma altera status da empresa');
    }

    const company = await this.companiesRepository.findById(id);
    if (!company) throw new NotFoundError('Empresa não encontrada');

    const updated = await this.companiesRepository.update(id, input);
    await this.auditService.log({
      tenantId: id,
      userId: actor.id,
      action: 'companies.update',
      resource: 'tenant',
      resourceId: id,
      metadata: input,
    });
    return updated;
  }

  async listUnits(actor: AuthUser, tenantId?: string) {
    if (isPlatformAdmin(actor)) {
      const targetTenantId = tenantId ?? actor.tenantId;
      return this.companiesRepository.listUnits(targetTenantId);
    }

    const targetTenantId = tenantId ?? actor.tenantId;
    if (targetTenantId !== actor.tenantId) {
      throw new ForbiddenError();
    }
    return this.companiesRepository.listUnits(targetTenantId);
  }

  async createUnit(actor: AuthUser, input: CreateUnitInput) {
    if (actor.role !== Role.GERENTE) {
      throw new ForbiddenError('Apenas gerente cria unidades');
    }

    const unit = await this.companiesRepository.createUnit({
      tenantId: actor.tenantId,
      name: input.name,
      code: input.code,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'units.create',
      resource: 'unit',
      resourceId: unit.id,
    });

    return unit;
  }
}
