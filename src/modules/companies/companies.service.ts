import { inject, injectable } from 'tsyringe';
import { Role } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
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
    if (actor.role === Role.ADMIN) {
      return this.companiesRepository.listAll();
    }

    const company = await this.companiesRepository.findById(actor.tenantId);
    if (!company) throw new NotFoundError('Empresa não encontrada');
    return [company];
  }

  async getById(actor: AuthUser, id: string) {
    if (actor.role !== Role.ADMIN && actor.tenantId !== id) {
      throw new ForbiddenError('Sem acesso a esta empresa');
    }

    const company = await this.companiesRepository.findById(id);
    if (!company) throw new NotFoundError('Empresa não encontrada');
    return company;
  }

  async create(actor: AuthUser, input: CreateCompanyInput) {
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenError('Apenas admin cria empresas');
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
    if (actor.role === Role.OPERACIONAL) {
      throw new ForbiddenError();
    }

    if (actor.role === Role.GESTOR && actor.tenantId !== id) {
      throw new ForbiddenError('Gestor só atualiza a própria empresa');
    }

    if (actor.role !== Role.ADMIN && input.isActive !== undefined) {
      throw new ForbiddenError('Apenas admin altera status da empresa');
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
    const targetTenantId = tenantId ?? actor.tenantId;
    if (actor.role !== Role.ADMIN && targetTenantId !== actor.tenantId) {
      throw new ForbiddenError();
    }
    return this.companiesRepository.listUnits(targetTenantId);
  }

  async createUnit(actor: AuthUser, input: CreateUnitInput) {
    if (actor.role === Role.OPERACIONAL) {
      throw new ForbiddenError();
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
