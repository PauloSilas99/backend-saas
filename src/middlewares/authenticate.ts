import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { container } from 'tsyringe';
import { env } from '@config/env';
import { UnauthorizedError } from '@shared/errors/AppError';
import { AuthService } from '@modules/auth/auth.service';
import { AuthUser } from '@/types/auth';

interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  tokenVersion: number;
  tenantId: string;
  role: AuthUser['role'];
  membershipId: string;
  type: 'access';
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Token ausente');
    }

    const token = header.slice(7);
    const payload = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;

    if (payload.type !== 'access') {
      throw new UnauthorizedError('Token inválido');
    }

    const authService = container.resolve(AuthService);
    const valid = await authService.validateAccessToken(payload);
    if (!valid) {
      throw new UnauthorizedError('Sessão inválida ou revogada');
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      tokenVersion: payload.tokenVersion,
      tenantId: payload.tenantId,
      role: payload.role,
      membershipId: payload.membershipId,
    };

    next();
  } catch (error) {
    next(error instanceof UnauthorizedError ? error : new UnauthorizedError('Token inválido'));
  }
}
