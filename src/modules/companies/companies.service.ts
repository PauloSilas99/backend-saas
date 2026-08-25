import { inject, injectable } from 'tsyringe';
import { Role } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import {
  canCreateCompany,
  canManageCompanySettings,
  isPlatformAdmin,
  isReadOnly,
} from '@shared/helpers/rbac';
import { CompaniesRepository } from './companies.repository';
import {
  CreateCompanyInput,
  CreateUnitInput,
  UpdateCompanyInput,
  UpdateUnitInput,
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
    this.assertTenantAccess(actor, id);
    const company = await this.companiesRepository.findById(id);
    if (!company) throw new NotFoundError('Empresa não encontrada');
    return company;
  }

  async create(actor: AuthUser, input: CreateCompanyInput) {
    if (!canCreateCompany(actor)) {
      throw new ForbiddenError('Sem permissão para criar empresas');
    }

    const slug =
      input.slug ??
      input.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 60);

    if (!slug) throw new ConflictError('Slug inválido');

    const existing = await this.companiesRepository.findBySlug(slug);
    if (existing) throw new ConflictError('Slug já em uso');

    if (isPlatformAdmin(actor)) {
      const company = await this.companiesRepository.createWithTrial({
        name: input.name,
        slug,
        document: input.document,
      });

      await this.auditService.log({
        tenantId: company.id,
        userId: actor.id,
        action: 'companies.create',
        resource: 'tenant',
        resourceId: company.id,
      });
      return company;
    }

    const company = await this.companiesRepository.createWithOwner({
      name: input.name,
      slug,
      document: input.document,
      ownerUserId: actor.id,
      role: Role.GERENTE,
    });

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
    if (isReadOnly(actor) || actor.role === Role.OPERACIONAL || actor.role === Role.GESTOR) {
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

  async remove(actor: AuthUser, id: string) {
    if (!canManageCompanySettings(actor)) {
      throw new ForbiddenError();
    }
    if (actor.role === Role.GERENTE && actor.tenantId !== id) {
      throw new ForbiddenError();
    }

    const company = await this.companiesRepository.findById(id);
    if (!company) throw new NotFoundError('Empresa não encontrada');

    const updated = await this.companiesRepository.softDelete(id);
    await this.auditService.log({
      tenantId: id,
      userId: actor.id,
      action: 'companies.delete',
      resource: 'tenant',
      resourceId: id,
    });
    return updated;
  }

  async listUnits(actor: AuthUser, empresaId?: string) {
    const tenantId = this.resolveEmpresaId(actor, empresaId);
    return this.companiesRepository.listUnits(tenantId);
  }

  async createUnit(actor: AuthUser, input: CreateUnitInput, empresaId?: string) {
    if (actor.role !== Role.GERENTE && !isPlatformAdmin(actor)) {
      throw new ForbiddenError('Apenas gerente cria unidades');
    }

    const tenantId = this.resolveEmpresaId(actor, empresaId ?? input.empresaId);
    const unit = await this.companiesRepository.createUnit({
      tenantId,
      name: input.name,
      code: input.code,
    });

    await this.auditService.log({
      tenantId,
      userId: actor.id,
      action: 'units.create',
      resource: 'unit',
      resourceId: unit.id,
    });

    return unit;
  }

  async updateUnit(actor: AuthUser, unitId: string, input: UpdateUnitInput) {
    if (actor.role !== Role.GERENTE && !isPlatformAdmin(actor)) {
      throw new ForbiddenError();
    }

    const unit = await this.companiesRepository.findUnit(unitId);
    if (!unit) throw new NotFoundError('Unidade não encontrada');
    this.assertTenantAccess(actor, unit.tenantId);

    const updated = await this.companiesRepository.updateUnit(unitId, input);
    await this.auditService.log({
      tenantId: unit.tenantId,
      userId: actor.id,
      action: 'units.update',
      resource: 'unit',
      resourceId: unitId,
      metadata: input,
    });
    return updated;
  }

  async removeUnit(actor: AuthUser, unitId: string) {
    if (actor.role !== Role.GERENTE && !isPlatformAdmin(actor)) {
      throw new ForbiddenError();
    }

    const unit = await this.companiesRepository.findUnit(unitId);
    if (!unit) throw new NotFoundError('Unidade não encontrada');
    this.assertTenantAccess(actor, unit.tenantId);

    const updated = await this.companiesRepository.softDeleteUnit(unitId);
    await this.auditService.log({
      tenantId: unit.tenantId,
      userId: actor.id,
      action: 'units.delete',
      resource: 'unit',
      resourceId: unitId,
    });
    return updated;
  }

  private resolveEmpresaId(actor: AuthUser, empresaId?: string): string {
    if (isPlatformAdmin(actor)) {
      return empresaId ?? actor.tenantId;
    }
    const target = empresaId ?? actor.tenantId;
    if (target !== actor.tenantId) {
      throw new ForbiddenError();
    }
    return target;
  }

  private assertTenantAccess(actor: AuthUser, tenantId: string) {
    if (!isPlatformAdmin(actor) && actor.tenantId !== tenantId) {
      throw new ForbiddenError('Sem acesso a esta empresa');
    }
  }
}
