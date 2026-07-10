import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/AppError';
import { hasRequiredRole } from '@shared/helpers/rbac';

export function roleGuard(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    if (!hasRequiredRole(req.user.role, allowed)) {
      next(new ForbiddenError('Perfil sem permissão para este recurso'));
      return;
    }

    next();
  };
}
