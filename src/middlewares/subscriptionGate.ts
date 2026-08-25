import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import { Role, SubscriptionStatus } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '@shared/errors/AppError';
import { BillingService } from '@modules/billing/billing.service';

const ACTIVE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
];

export async function subscriptionGate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    if (req.user.role === Role.PLATFORM_ADMIN) {
      next();
      return;
    }

    const billingService = container.resolve(BillingService);
    const status = await billingService.getCachedSubscriptionStatus(req.user.tenantId);

    if (!status || !ACTIVE_STATUSES.includes(status)) {
      throw new ForbiddenError(
        'Assinatura inativa. Regularize o pagamento para continuar usando o sistema.',
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
