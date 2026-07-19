import { inject, injectable } from 'tsyringe';
import { ActionStatus, Role } from '@prisma/client';
import { ForbiddenError } from '@shared/errors/AppError';
import { AuthUser } from '@/types/auth';
import { isPlatformAdmin } from '@shared/helpers/rbac';
import { AnalyticsRepository, AnalyticsScope } from './analytics.repository';
import { AnalyticsFilterInput } from './analytics.schemas';

@injectable()
export class AnalyticsService {
  constructor(
    @inject(AnalyticsRepository)
    private readonly analyticsRepository: AnalyticsRepository,
  ) {}

  async kpis(actor: AuthUser, filters: AnalyticsFilterInput) {
    return this.analyticsRepository.getKpis(this.buildScope(actor, filters));
  }

  async monthly(actor: AuthUser, filters: AnalyticsFilterInput) {
    return this.analyticsRepository.getMonthly(this.buildScope(actor, filters));
  }

  async byUnit(actor: AuthUser, filters: AnalyticsFilterInput) {
    return this.analyticsRepository.getByUnit(this.buildScope(actor, filters));
  }

  async byResponsible(actor: AuthUser, filters: AnalyticsFilterInput) {
    return this.analyticsRepository.getByResponsible(this.buildScope(actor, filters));
  }

  async adherence(actor: AuthUser, filters: AnalyticsFilterInput) {
    return this.analyticsRepository.getAdherence(this.buildScope(actor, filters));
  }

  private buildScope(actor: AuthUser, filters: AnalyticsFilterInput): AnalyticsScope {
    if (filters.tenantId && filters.tenantId !== actor.tenantId) {
      throw new ForbiddenError('Sem acesso a analytics de outra empresa');
    }

    const tenantId = actor.tenantId;

    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError(
        'Admin da plataforma não acessa analytics operacionais das empresas',
      );
    }

    const scope: AnalyticsScope = {
      tenantId,
      unitId: filters.unitId,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      status: filters.status as ActionStatus | undefined,
    };

    if (actor.role === Role.OPERACIONAL) {
      scope.responsibleId = actor.id;
    } else if (filters.responsibleId) {
      scope.responsibleId = filters.responsibleId;
    }

    return scope;
  }
}
