import { inject, injectable } from 'tsyringe';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import { UsersRepository } from './users.repository';
import { CreateUserInput, UpdateUserInput } from './users.schemas';

@injectable()
export class UsersService {
  constructor(
    @inject(UsersRepository) private readonly usersRepository: UsersRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthUser) {
    this.assertCanManageUsers(actor);
    const memberships = await this.usersRepository.listByTenant(actor.tenantId);

    if (actor.role === Role.GESTOR) {
      return memberships
        .filter((m) => m.role !== Role.ADMIN)
        .map((m) => this.mapMembership(m));
    }

    return memberships.map((m) => this.mapMembership(m));
  }

  async create(actor: AuthUser, input: CreateUserInput) {
    this.assertCanManageUsers(actor);

    if (actor.role === Role.GESTOR && input.role === Role.ADMIN) {
      throw new ForbiddenError('Gestor não pode criar admin');
    }

    const existing = await this.usersRepository.findByEmail(input.email.toLowerCase());
    if (existing) {
      throw new ConflictError('E-mail já cadastrado');
    }

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
    this.assertCanManageUsers(actor);

    const membership = await this.usersRepository.findMembership(userId, actor.tenantId);
    if (!membership) {
      throw new NotFoundError('Usuário não encontrado nesta empresa');
    }

    if (actor.role === Role.GESTOR && membership.role === Role.ADMIN) {
      throw new ForbiddenError('Gestor não pode alterar admin');
    }

    if (actor.role === Role.GESTOR && input.role === Role.ADMIN) {
      throw new ForbiddenError('Gestor não pode promover a admin');
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
    if (actor.role === Role.OPERACIONAL && actor.id !== userId) {
      throw new ForbiddenError('Operacional só pode ver os próprios dados');
    }

    if (actor.role !== Role.OPERACIONAL) {
      this.assertCanManageUsers(actor);
    }

    const membership = await this.usersRepository.findMembership(userId, actor.tenantId);
    if (!membership) {
      throw new NotFoundError('Usuário não encontrado');
    }

    return this.mapMembership(membership);
  }

  private assertCanManageUsers(actor: AuthUser) {
    if (actor.role === Role.OPERACIONAL) {
      throw new ForbiddenError('Operacional não gerencia usuários');
    }
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
