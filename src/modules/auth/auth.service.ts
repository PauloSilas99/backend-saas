import { inject, injectable } from 'tsyringe';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '@config/env';
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '@shared/errors/AppError';
import { generateRefreshToken, hashToken } from '@shared/helpers/crypto';
import { AuditService } from '@shared/audit/audit.service';
import { AuthRepository } from './auth.repository';
import { LoginInput, RefreshInput, RegisterInput } from './auth.schemas';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

@injectable()
export class AuthService {
  constructor(
    @inject(AuthRepository) private readonly authRepository: AuthRepository,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async register(input: RegisterInput) {
    const existing = await this.authRepository.findUserByEmail(input.email.toLowerCase());
    if (existing) {
      throw new ConflictError('E-mail já cadastrado');
    }

    const tenantName = input.tenantName ?? `${input.name}'s Company`;
    const tenantSlug =
      input.tenantSlug ??
      tenantName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 60);

    if (!tenantSlug) {
      throw new ValidationError('Slug da empresa inválido');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const result = await this.authRepository.createUserWithTenant({
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      tenantName,
      tenantSlug,
      role: Role.GERENTE,
    });

    const tokens = await this.issueTokens({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      tokenVersion: result.user.tokenVersion,
      tenantId: result.tenant.id,
      role: result.membership.role,
      membershipId: result.membership.id,
    });

    await this.auditService.log({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: 'auth.register',
      resource: 'user',
      resourceId: result.user.id,
    });

    return {
      user: this.sanitizeUser(result.user, result.membership.role, result.tenant.id),
      ...tokens,
    };
  }

  async login(input: LoginInput) {
    const user = await this.authRepository.findUserByEmail(input.email.toLowerCase());
    if (!user || !user.isActive) {
      throw new UnauthorizedError('Credenciais inválidas');
    }

    const validPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedError('Credenciais inválidas');
    }

    let membership = user.memberships[0];
    if (input.tenantSlug) {
      membership =
        user.memberships.find((m) => m.tenant.slug === input.tenantSlug) ?? membership;
    }

    if (!membership) {
      throw new ForbiddenError('Usuário sem vínculo com empresa');
    }

    const tokens = await this.issueTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      tokenVersion: user.tokenVersion,
      tenantId: membership.tenantId,
      role: membership.role,
      membershipId: membership.id,
    });

    await this.auditService.log({
      tenantId: membership.tenantId,
      userId: user.id,
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
    });

    return {
      user: this.sanitizeUser(user, membership.role, membership.tenantId),
      ...tokens,
    };
  }

  async refresh(input: RefreshInput) {
    const tokenHash = hashToken(input.refreshToken);
    const stored = await this.authRepository.findRefreshToken(tokenHash);

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token inválido ou expirado');
    }

    if (!stored.user.isActive) {
      throw new UnauthorizedError('Usuário inativo');
    }

    await this.authRepository.revokeRefreshToken(stored.id);

    const membership = stored.user.memberships[0];
    if (!membership) {
      throw new ForbiddenError('Usuário sem vínculo com empresa');
    }

    return this.issueTokens({
      id: stored.user.id,
      email: stored.user.email,
      name: stored.user.name,
      tokenVersion: stored.user.tokenVersion,
      tenantId: membership.tenantId,
      role: membership.role,
      membershipId: membership.id,
    });
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const tokenHash = hashToken(refreshToken);
      const stored = await this.authRepository.findRefreshToken(tokenHash);
      if (stored && stored.userId === userId) {
        await this.authRepository.revokeRefreshToken(stored.id);
      }
    } else {
      await this.authRepository.revokeAllUserTokens(userId);
    }

    await this.auditService.log({
      userId,
      action: 'auth.logout',
      resource: 'user',
      resourceId: userId,
    });

    return { success: true };
  }

  async me(userId: string, tenantId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError();
    }

    const membership = user.memberships.find((m) => m.tenantId === tenantId);
    if (!membership) {
      throw new ForbiddenError('Sem acesso a esta empresa');
    }

    return {
      ...this.sanitizeUser(user, membership.role, tenantId),
      tenant: {
        id: membership.tenant.id,
        name: membership.tenant.name,
        slug: membership.tenant.slug,
      },
      memberships: user.memberships.map((m) => ({
        id: m.id,
        role: m.role,
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        tenantSlug: m.tenant.slug,
      })),
    };
  }

  async validateAccessToken(payload: {
    sub: string;
    tokenVersion: number;
  }): Promise<boolean> {
    const user = await this.authRepository.findUserById(payload.sub);
    if (!user || !user.isActive) return false;
    return user.tokenVersion === payload.tokenVersion;
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    name: string;
    tokenVersion: number;
    tenantId: string;
    role: Role;
    membershipId: string;
  }): Promise<TokenPair> {
    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        tokenVersion: user.tokenVersion,
        tenantId: user.tenantId,
        role: user.role,
        membershipId: user.membershipId,
        type: 'access',
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN } as jwt.SignOptions,
    );

    const refreshToken = generateRefreshToken();
    const expiresAt = this.resolveExpiryDate(env.JWT_REFRESH_EXPIRES_IN);

    await this.authRepository.createRefreshToken({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    };
  }

  private resolveExpiryDate(expiresIn: string): Date {
    const match = /^(\d+)([smhd])$/.exec(expiresIn);
    if (!match) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() + value * multipliers[unit]);
  }

  private sanitizeUser(
    user: { id: string; email: string; name: string; isActive: boolean },
    role: Role,
    tenantId: string,
  ) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      role,
      tenantId,
    };
  }
}
