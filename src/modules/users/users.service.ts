import { inject, injectable } from 'tsyringe';
import { Role } from '@prisma/client';
import { env } from '@config/env';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { MailService } from '@shared/mail/mail.service';
import { AuthUser } from '@/types/auth';
import {
  canAssignRole,
  canManageCompanyTeam,
  canManageUsers,
  isOperacional,
  isPlatformAdmin,
  isReadOnly,
} from '@shared/helpers/rbac';
import { toFeRole } from '@shared/helpers/roles';
import { invalidateSessionCache } from '@config/redis-cache';
import { UsersRepository, generateTemporaryPassword } from './users.repository';
import { CreateUserInput, UpdateUserInput } from './users.schemas';

@injectable()
export class UsersService {
  constructor(
    @inject(UsersRepository) private readonly usersRepository: UsersRepository,
    @inject(AuditService) private readonly auditService: AuditService,
    @inject(MailService) private readonly mailService: MailService,
  ) {}

  async list(actor: AuthUser, q?: string) {
    if (isPlatformAdmin(actor)) {
      const users = await this.usersRepository.listAll(q);
      return users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        whatsapp: user.whatsapp ?? null,
        isActive: user.isActive,
        emailVerified: Boolean(user.emailVerifiedAt),
        createdAt: user.createdAt,
        memberships: user.memberships.map((m) => ({
          id: m.id,
          role: m.role,
          tenantId: m.tenantId,
          tenantName: m.tenant.name,
          isActive: m.isActive,
        })),
      }));
    }

    // Typeahead for managers/operacional selecting responsible
    if (q !== undefined && !canManageUsers(actor)) {
      const rows = await this.usersRepository.searchTypeahead(actor.tenantId, q);
      return rows.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      }));
    }

    if (!canManageUsers(actor)) {
      throw new ForbiddenError('Apenas gerente gerencia usuários');
    }

    const memberships = await this.usersRepository.listByTenant(actor.tenantId, q);
    return memberships
      .filter((m) => m.role !== Role.PLATFORM_ADMIN)
      .map((m) => this.mapMembership(m));
  }

  async listMembers(actor: AuthUser, empresaId: string, q?: string) {
    this.assertEmpresaAccess(actor, empresaId);
    if (!canManageCompanyTeam(actor) && actor.role !== Role.GESTOR && !isReadOnly(actor)) {
      throw new ForbiddenError();
    }
    const memberships = await this.usersRepository.listByTenant(empresaId, q);
    return memberships
      .filter((m) => m.role !== Role.PLATFORM_ADMIN)
      .map((m) => this.mapMembership(m));
  }

  async create(actor: AuthUser, input: CreateUserInput, empresaId?: string) {
    if (!canManageCompanyTeam(actor)) {
      throw new ForbiddenError('Apenas gerente cria usuários');
    }

    const tenantId = empresaId ?? actor.tenantId;
    this.assertEmpresaAccess(actor, tenantId);

    if (input.role === Role.PLATFORM_ADMIN) {
      throw new ForbiddenError('Não é permitido atribuir este perfil');
    }

    if (!canAssignRole(actor.role, input.role)) {
      throw new ForbiddenError('Não é permitido atribuir este perfil');
    }

    const existing = await this.usersRepository.findByEmail(input.email.toLowerCase());
    if (existing) {
      throw new ConflictError('E-mail já cadastrado');
    }

    const temporaryPassword = input.password ?? generateTemporaryPassword();
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const result = await this.usersRepository.createInTenant({
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      tenantId,
      role: input.role,
    });

    await this.auditService.log({
      tenantId,
      userId: actor.id,
      action: 'users.create',
      resource: 'user',
      resourceId: result.user.id,
      metadata: { role: input.role },
    });

    return {
      id: result.user.id,
      membershipId: result.membership.id,
      email: result.user.email,
      name: result.user.name,
      role: result.membership.role,
      cargo: toFeRole(result.membership.role),
      isActive: result.user.isActive,
      temporaryPassword: input.password ? undefined : temporaryPassword,
    };
  }

  async update(actor: AuthUser, userId: string, input: UpdateUserInput, empresaId?: string) {
    if (!canManageCompanyTeam(actor)) {
      throw new ForbiddenError('Apenas gerente atualiza usuários');
    }

    const tenantId = empresaId ?? actor.tenantId;
    this.assertEmpresaAccess(actor, tenantId);

    const membership = await this.usersRepository.findMembership(userId, tenantId);
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

    if (input.role !== undefined || input.isActive === false) {
      await this.usersRepository.updateMembership(membership.id, {
        role: input.role,
        isActive: input.isActive,
      });
    }

    await this.auditService.log({
      tenantId,
      userId: actor.id,
      action: 'users.update',
      resource: 'user',
      resourceId: userId,
      metadata: input,
    });

    const updated = await this.usersRepository.findMembership(userId, tenantId);
    return this.mapMembership(updated!);
  }

  async remove(actor: AuthUser, userId: string, empresaId?: string) {
    if (isPlatformAdmin(actor) && !empresaId) {
      if (actor.id === userId) {
        throw new ForbiddenError('Não é possível excluir a própria conta de admin');
      }
      const existing = await this.usersRepository.findUserById(userId);
      if (!existing) throw new NotFoundError('Usuário não encontrado');
      if (existing.isPlatformAdmin) {
        throw new ForbiddenError('Não é possível excluir um administrador da plataforma');
      }

      await this.usersRepository.hardDeleteUser(userId, actor.id);
      await this.auditService.log({
        userId: actor.id,
        action: 'users.hard-delete',
        resource: 'user',
        resourceId: userId,
      });
      return { id: userId, deleted: true, hard: true };
    }

    if (!canManageCompanyTeam(actor)) {
      throw new ForbiddenError();
    }
    const tenantId = empresaId ?? actor.tenantId;
    this.assertEmpresaAccess(actor, tenantId);

    const membership = await this.usersRepository.findMembership(userId, tenantId);
    if (!membership) {
      throw new NotFoundError('Member não encontrado');
    }

    await this.usersRepository.updateMembership(membership.id, { isActive: false });
    await this.usersRepository.updateUser(userId, { isActive: false });

    await this.auditService.log({
      tenantId,
      userId: actor.id,
      action: 'users.delete',
      resource: 'user',
      resourceId: userId,
    });

    return { id: userId, deleted: true };
  }

  async setActive(actor: AuthUser, userId: string, isActive: boolean) {
    if (!isPlatformAdmin(actor)) {
      throw new ForbiddenError('Apenas admin da plataforma');
    }
    if (actor.id === userId && !isActive) {
      throw new ForbiddenError('Não é possível desativar a própria conta');
    }
    const existing = await this.usersRepository.findUserById(userId);
    if (!existing) throw new NotFoundError('Usuário não encontrado');
    if (existing.isPlatformAdmin) {
      throw new ForbiddenError('Conta de administrador da plataforma não é gerenciada aqui');
    }

    const wasInactive = !existing.isActive;
    await this.usersRepository.updateUser(userId, { isActive });
    if (!isActive) {
      await this.usersRepository.deactivateAllMemberships(userId);
      await this.usersRepository.bumpTokenVersion(userId);
      await invalidateSessionCache(userId);
    } else {
      await this.usersRepository.reactivatePrimaryMemberships(userId);
      if (wasInactive) {
        const loginUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/login`;
        await this.mailService.send({
          to: existing.email,
          subject: 'Acesso liberado',
          text: [
            `Olá${existing.name ? `, ${existing.name}` : ''}!`,
            '',
            'Um administrador liberou o acesso à sua conta.',
            `Você já pode entrar: ${loginUrl}`,
            '',
          ].join('\n'),
          html: [
            `<p>Olá${existing.name ? `, <strong>${existing.name}</strong>` : ''}!</p>`,
            `<p>Um administrador <strong>liberou o acesso</strong> à sua conta.</p>`,
            `<p><a href="${loginUrl}">Entrar no sistema</a></p>`,
          ].join(''),
        });
      }
    }

    await this.auditService.log({
      userId: actor.id,
      action: isActive ? 'users.activate' : 'users.deactivate',
      resource: 'user',
      resourceId: userId,
    });

    return {
      id: userId,
      isActive,
    };
  }

  async removeMembership(actor: AuthUser, membershipId: string) {
    if (!canManageCompanyTeam(actor)) {
      throw new ForbiddenError();
    }
    const membership = await this.usersRepository.findMembershipById(membershipId);
    if (!membership) throw new NotFoundError('Member não encontrado');
    this.assertEmpresaAccess(actor, membership.tenantId);

    await this.usersRepository.updateMembership(membership.id, { isActive: false });
    return { id: membership.userId, membershipId, deleted: true };
  }

  async getById(actor: AuthUser, userId: string) {
    if (isPlatformAdmin(actor)) {
      const user = await this.usersRepository.findUserById(userId);
      if (!user) throw new NotFoundError('Usuário não encontrado');
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        whatsapp: user.whatsapp ?? null,
        isActive: user.isActive,
        emailVerified: Boolean(user.emailVerifiedAt),
        createdAt: user.createdAt,
        memberships: user.memberships.map((m) => ({
          id: m.id,
          role: m.role,
          tenantId: m.tenantId,
          tenantName: m.tenant.name,
          isActive: m.isActive,
        })),
      };
    }

    if (isOperacional(actor) && actor.id !== userId) {
      throw new ForbiddenError('Operacional só pode ver os próprios dados');
    }

    if (
      !isOperacional(actor) &&
      !canManageUsers(actor) &&
      actor.role !== Role.GESTOR &&
      !isReadOnly(actor)
    ) {
      throw new ForbiddenError();
    }

    const membership = await this.usersRepository.findMembership(userId, actor.tenantId);
    if (!membership) {
      throw new NotFoundError('Usuário não encontrado');
    }
    return this.mapMembership(membership);
  }

  private assertEmpresaAccess(actor: AuthUser, empresaId: string) {
    if (!isPlatformAdmin(actor) && actor.tenantId !== empresaId) {
      throw new ForbiddenError('Sem acesso a esta empresa');
    }
  }

  private mapMembership(membership: {
    id?: string;
    role: Role;
    isActive: boolean;
    user: { id: string; email: string; name: string; isActive: boolean; createdAt?: Date };
  }) {
    return {
      id: membership.user.id,
      membershipId: membership.id,
      email: membership.user.email,
      name: membership.user.name,
      isActive: membership.user.isActive && membership.isActive,
      role: membership.role,
      cargo: toFeRole(membership.role),
      createdAt: membership.user.createdAt,
    };
  }
}
