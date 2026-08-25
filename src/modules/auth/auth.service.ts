import { inject, injectable } from 'tsyringe';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { AuthTokenType, Role } from '@prisma/client';
import { env } from '@config/env';
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '@shared/errors/AppError';
import { generateRefreshToken, hashToken } from '@shared/helpers/crypto';
import { AuditService } from '@shared/audit/audit.service';
import { MailService } from '@shared/mail/mail.service';
import { AuthRepository } from './auth.repository';
import {
  ForgotPasswordInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  SwitchTenantInput,
  UpdateMeInput,
  VerifyEmailInput,
} from './auth.schemas';
import {
  cacheGetJson,
  cacheSetJson,
  invalidateSessionCache,
  sessionCacheKey,
} from '@config/redis-cache';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';
import {
  PLATFORM_ACTOR_MEMBERSHIP_ID,
  PLATFORM_ACTOR_TENANT_ID,
} from '@shared/auth/platform-scope';

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
    @inject(MailService) private readonly mailService: MailService,
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
    const smtpConfigured = Boolean(env.SMTP_HOST?.trim());
    const result = await this.authRepository.createUserWithTenant({
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      whatsapp: input.whatsapp,
      tenantName,
      tenantSlug,
      role: Role.GERENTE,
      emailVerified: !smtpConfigured,
    });

    let verify: { token: string; devUrl: string } | null = null;
    if (smtpConfigured) {
      verify = await this.issueEmailVerification(result.user.id, result.user.email);
    }

    await this.auditService.log({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: 'auth.register',
      resource: 'user',
      resourceId: result.user.id,
    });

    if (smtpConfigured && verify) {
      return {
        verificationRequired: true as const,
        email: result.user.email,
        message:
          'Conta criada. Verifique seu e-mail. Depois disso, um administrador libera o acesso.',
        ...(env.NODE_ENV !== 'production' && verify.devUrl
          ? { devVerificationUrl: verify.devUrl }
          : {}),
      };
    }

    return {
      verificationRequired: false as const,
      pendingAdminApproval: true as const,
      email: result.user.email,
      message:
        'Conta criada. Aguarde um administrador liberar o acesso para você entrar.',
    };
  }

  async login(input: LoginInput) {
    const user = await this.authRepository.findUserByEmail(input.email.toLowerCase());
    if (!user) {
      throw new UnauthorizedError('Credenciais inválidas');
    }

    const validPassword = await bcrypt.compare(input.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedError('Credenciais inválidas');
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenError(
        'E-mail ainda não confirmado. Verifique sua caixa de entrada ou reenvie o link.',
      );
    }

    if (!user.isActive) {
      throw new ForbiddenError(
        'Sem acesso a conta. Aguarde a liberação do administrador.',
      );
    }

    if (
      user.isPlatformAdmin ||
      user.memberships.some((m) => m.role === Role.PLATFORM_ADMIN)
    ) {
      const tokens = await this.issuePlatformAdminTokens(user);
      await this.auditService.log({
        userId: user.id,
        action: 'auth.login',
        resource: 'user',
        resourceId: user.id,
      });
      return {
        user: this.sanitizeUser(user, Role.PLATFORM_ADMIN, null),
        ...tokens,
      };
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

    if (!stored.user.emailVerifiedAt) {
      throw new UnauthorizedError('E-mail não confirmado');
    }

    await this.authRepository.revokeRefreshToken(stored.id);

    if (
      stored.user.isPlatformAdmin ||
      stored.user.memberships.some((m) => m.role === Role.PLATFORM_ADMIN)
    ) {
      return this.issuePlatformAdminTokens(stored.user);
    }

    const preferredTenantId = input.tenantId ?? stored.tenantId ?? undefined;
    const membership =
      (preferredTenantId
        ? stored.user.memberships.find((m) => m.tenantId === preferredTenantId)
        : undefined) ?? stored.user.memberships[0];
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
      await invalidateSessionCache(userId);
    }

    await this.auditService.log({
      userId,
      action: 'auth.logout',
      resource: 'user',
      resourceId: userId,
    });

    return { success: true };
  }

  async switchTenant(actor: { id: string }, input: SwitchTenantInput) {
    const user = await this.authRepository.findUserById(actor.id);
    if (!user || !user.isActive) {
      throw new UnauthorizedError();
    }

    if (
      user.isPlatformAdmin ||
      user.memberships.some((m) => m.role === Role.PLATFORM_ADMIN)
    ) {
      const tokens = await this.issuePlatformAdminTokens(user);
      await this.auditService.log({
        tenantId: input.tenantId,
        userId: user.id,
        action: 'auth.switch-tenant',
        resource: 'tenant',
        resourceId: input.tenantId,
      });
      return {
        user: this.sanitizeUser(user, Role.PLATFORM_ADMIN, null),
        ...tokens,
      };
    }

    const membership = user.memberships.find((m) => m.tenantId === input.tenantId);
    if (!membership) {
      throw new ForbiddenError('Sem acesso a esta empresa');
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
      action: 'auth.switch-tenant',
      resource: 'tenant',
      resourceId: membership.tenantId,
    });

    return {
      user: this.sanitizeUser(user, membership.role, membership.tenantId),
      ...tokens,
    };
  }

  async me(userId: string, tenantId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedError();
    }

    if (
      user.isPlatformAdmin ||
      user.memberships.some((m) => m.role === Role.PLATFORM_ADMIN)
    ) {
      return {
        ...this.sanitizeUser(user, Role.PLATFORM_ADMIN, null),
        emailVerifiedAt: user.emailVerifiedAt,
        tenant: null,
        memberships: [],
      };
    }

    const membership = user.memberships.find((m) => m.tenantId === tenantId);
    if (!membership) {
      throw new ForbiddenError('Sem acesso a esta empresa');
    }

    return {
      ...this.sanitizeUser(user, membership.role, tenantId),
      emailVerifiedAt: user.emailVerifiedAt,
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

  async updateMe(userId: string, tenantId: string, input: UpdateMeInput) {
    const user = await this.authRepository.findUserById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError();
    }

    if (input.currentPassword && input.newPassword) {
      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new ValidationError('Senha atual incorreta');
      }
      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      await this.authRepository.updatePassword(userId, passwordHash);
    }

    if (input.name?.trim()) {
      await this.authRepository.updateProfile(userId, { name: input.name.trim() });
    }

    return this.me(userId, tenantId);
  }

  async verifyEmail(input: VerifyEmailInput) {
    const tokenHash = hashToken(input.token);
    const stored = await this.authRepository.findValidAuthToken(
      tokenHash,
      AuthTokenType.EMAIL_VERIFY,
    );
    if (!stored) {
      throw new ValidationError('Link de verificação inválido ou expirado');
    }

    await this.authRepository.markAuthTokenUsed(stored.id);
    await this.authRepository.markEmailVerified(stored.userId);

    await this.mailService.send({
      to: stored.user.email,
      subject: 'Bem-vindo — aguardando liberação de acesso',
      text: [
        `Olá${stored.user.name ? `, ${stored.user.name}` : ''}!`,
        '',
        'Seu e-mail foi confirmado com sucesso.',
        'Aguarde um administrador liberar o acesso à sua conta.',
        'Você receberá um aviso quando puder entrar no sistema.',
        '',
      ].join('\n'),
      html: [
        `<p>Olá${stored.user.name ? `, <strong>${stored.user.name}</strong>` : ''}!</p>`,
        `<p>Seu e-mail foi confirmado com sucesso.</p>`,
        `<p><strong>Aguarde um administrador liberar o acesso</strong> à sua conta.</p>`,
        `<p>Você receberá um aviso quando puder entrar no sistema.</p>`,
      ].join(''),
    });

    await this.auditService.log({
      userId: stored.userId,
      action: 'auth.verify-email',
      resource: 'user',
      resourceId: stored.userId,
    });

    return {
      verified: true,
      email: stored.user.email,
      message:
        'E-mail confirmado. Bem-vindo! Aguarde um administrador liberar o acesso.',
    };
  }

  async resendVerification(email: string) {
    const user = await this.authRepository.findUserByEmail(email.toLowerCase());
    // Resposta genérica para não vazar existência de conta
    if (!user || user.emailVerifiedAt) {
      return {
        ok: true,
        message: 'Se o e-mail existir e ainda não estiver confirmado, enviaremos um novo link.',
      };
    }

    const verify = await this.issueEmailVerification(user.id, user.email);
    return {
      ok: true,
      message: 'Se o e-mail existir e ainda não estiver confirmado, enviaremos um novo link.',
      ...(env.NODE_ENV !== 'production' && verify.devUrl ? { devVerificationUrl: verify.devUrl } : {}),
    };
  }

  async forgotPassword(input: ForgotPasswordInput) {
    const user = await this.authRepository.findUserByEmail(input.email.toLowerCase());
    if (!user || !user.isActive) {
      return {
        ok: true,
        message: 'Se o e-mail existir, enviaremos instruções para redefinir a senha.',
      };
    }

    await this.authRepository.invalidateAuthTokens(user.id, AuthTokenType.PASSWORD_RESET);
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.authRepository.createAuthToken({
      userId: user.id,
      type: AuthTokenType.PASSWORD_RESET,
      tokenHash: hashToken(rawToken),
      expiresAt,
    });

    const resetUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
    await this.mailService.send({
      to: user.email,
      subject: 'Redefinição de senha',
      text: `Use este link para redefinir sua senha (válido por 1 hora):\n\n${resetUrl}\n`,
      html: `<p>Use este link para redefinir sua senha (válido por 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    });

    return {
      ok: true,
      message: 'Se o e-mail existir, enviaremos instruções para redefinir a senha.',
      ...(env.NODE_ENV !== 'production' ? { devResetUrl: resetUrl } : {}),
    };
  }

  async resetPassword(input: ResetPasswordInput) {
    const tokenHash = hashToken(input.token);
    const stored = await this.authRepository.findValidAuthToken(
      tokenHash,
      AuthTokenType.PASSWORD_RESET,
    );
    if (!stored) {
      throw new ValidationError('Link de redefinição inválido ou expirado');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    await this.authRepository.markAuthTokenUsed(stored.id);
    await this.authRepository.updatePassword(stored.userId, passwordHash);
    await this.authRepository.revokeAllUserTokens(stored.userId);
    await invalidateSessionCache(stored.userId);

    await this.auditService.log({
      userId: stored.userId,
      action: 'auth.reset-password',
      resource: 'user',
      resourceId: stored.userId,
    });

    return { ok: true, message: 'Senha atualizada. Faça login com a nova senha.' };
  }

  async validateAccessToken(payload: {
    sub: string;
    tokenVersion: number;
  }): Promise<boolean> {
    const cached = await cacheGetJson<{ v: number; a: boolean }>(sessionCacheKey(payload.sub));
    if (cached) {
      return cached.a && cached.v === payload.tokenVersion;
    }

    const user = await this.authRepository.findSessionState(payload.sub);
    if (!user) return false;

    await cacheSetJson(
      sessionCacheKey(payload.sub),
      { v: user.tokenVersion, a: user.isActive },
      PRODUCT_LIMITS.sessionCacheTtlSec,
    );
    return user.isActive && user.tokenVersion === payload.tokenVersion;
  }

  private async issueEmailVerification(userId: string, email: string) {
    await this.authRepository.invalidateAuthTokens(userId, AuthTokenType.EMAIL_VERIFY);
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.authRepository.createAuthToken({
      userId,
      type: AuthTokenType.EMAIL_VERIFY,
      tokenHash: hashToken(rawToken),
      expiresAt,
    });

    const verifyUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/verify-email?token=${rawToken}`;
    await this.mailService.send({
      to: email,
      subject: 'Confirme seu e-mail',
      text: [
        'Confirme seu e-mail clicando no link (válido por 24h):',
        '',
        verifyUrl,
        '',
        'Depois da confirmação, um administrador precisará liberar o acesso à sua conta.',
        '',
      ].join('\n'),
      html: [
        `<p>Confirme seu e-mail clicando no link (válido por 24h):</p>`,
        `<p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
        `<p>Depois da confirmação, um administrador precisará liberar o acesso à sua conta.</p>`,
      ].join(''),
    });

    return { token: rawToken, devUrl: verifyUrl };
  }

  private async issuePlatformAdminTokens(user: {
    id: string;
    email: string;
    name: string;
    tokenVersion: number;
  }): Promise<TokenPair> {
    return this.issueTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      tokenVersion: user.tokenVersion,
      tenantId: PLATFORM_ACTOR_TENANT_ID,
      role: Role.PLATFORM_ADMIN,
      membershipId: PLATFORM_ACTOR_MEMBERSHIP_ID,
    });
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
      tenantId: user.role === Role.PLATFORM_ADMIN ? undefined : user.tenantId,
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
    user: {
      id: string;
      email: string;
      name: string;
      isActive: boolean;
      emailVerifiedAt?: Date | null;
    },
    role: Role,
    tenantId: string | null,
  ) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      emailVerified: Boolean(user.emailVerifiedAt),
      role,
      tenantId,
    };
  }
}
