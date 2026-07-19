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
  canAssignRole,
  canManageUsers,
  isOperacional,
  isPlatformAdmin,
} from '@shared/helpers/rbac';
import { UsersRepository } from './users.repository';
import { CreateUserInput, UpdateUserInput } from './users.schemas';

@injectable()
export class UsersService {
  constructor(
    @inject(UsersRepository) private readonly usersRepository: UsersRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthUser) {
    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError('Admin da plataforma não lista usuários operacionais');
    }
    if (!canManageUsers(actor)) {
      throw new ForbiddenError('Apenas gerente gerencia usuários');
    }

    const memberships = await this.usersRepository.listByTenant(actor.tenantId);
    return memberships
      .filter((m) => m.role !== Role.PLATFORM_ADMIN)
      .map((m) => this.mapMembership(m));
  }

  async create(actor: AuthUser, input: CreateUserInput) {
    if (!canManageUsers(actor)) {
      throw new ForbiddenError('Apenas gerente cria usuários');
    }

    if (!canAssignRole(actor.role, input.role)) {
      throw new ForbiddenError('Não é permitido atribuir este perfil');
    }

    const existing = await this.usersRepository.findByEmail(input.email.toLowerCase());
    if (existing) {
      throw new ConflictError('E-mail já cadastrado');
    }

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(input.password, 10);
    const result = await this.usersRepository.createInTenant({
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      tenantId: actor.tenantId,
      role: input.role,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'users.create',
      resource: 'user',
      resourceId: result.user.id,
      metadata: { role: input.role },
    });

    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.membership.role,
      isActive: result.user.isActive,
    };
  }

  async update(actor: AuthUser, userId: string, input: UpdateUserInput) {
    if (!canManageUsers(actor)) {
      throw new ForbiddenError('Apenas gerente atualiza usuários');
    }

    const membership = await this.usersRepository.findMembership(userId, actor.tenantId);
    if (!membership) {
      throw new NotFoundError('Usuário não encontrado nesta empresa');
    }

    if (membership.role === Role.PLATFORM_ADMIN) {
      throw new ForbiddenError();
    }

    if (input.role !== undefined && !canAssignRole(actor.role, input.role)) {
      throw new ForbiddenError('Não é permitido atribuir este perfil');
    }

    if (input.name !== undefined || input.isActive !== undefined) {
      await this.usersRepository.updateUser(userId, {
        name: input.name,
        isActive: input.isActive,
      });
    }

    if (input.role !== undefined) {
      await this.usersRepository.updateMembership(membership.id, { role: input.role });
    }

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'users.update',
      resource: 'user',
      resourceId: userId,
      metadata: input,
    });

    const updated = await this.usersRepository.findMembership(userId, actor.tenantId);
    return this.mapMembership(updated!);
  }

  async getById(actor: AuthUser, userId: string) {
    if (isPlatformAdmin(actor)) {
      throw new ForbiddenError();
    }

    if (isOperacional(actor) && actor.id !== userId) {
      throw new ForbiddenError('Operacional só pode ver os próprios dados');
    }

    if (!isOperacional(actor) && !canManageUsers(actor) && actor.role !== Role.GESTOR) {
      throw new ForbiddenError();
    }

    // Gestor can view users in company (read), gerente manages
    if (actor.role === Role.GESTOR || canManageUsers(actor) || actor.id === userId) {
      const membership = await this.usersRepository.findMembership(userId, actor.tenantId);
      if (!membership) {
        throw new NotFoundError('Usuário não encontrado');
      }
      return this.mapMembership(membership);
    }

    throw new ForbiddenError();
  }

  private mapMembership(membership: {
    role: Role;
    isActive: boolean;
    user: { id: string; email: string; name: string; isActive: boolean; createdAt?: Date };
  }) {
    return {
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      isActive: membership.user.isActive && membership.isActive,
      role: membership.role,
      createdAt: membership.user.createdAt,
    };
  }
}
