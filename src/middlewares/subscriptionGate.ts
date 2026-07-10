import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import { SubscriptionStatus } from '@prisma/client';
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

    const billingService = container.resolve(BillingService);
    const subscription = await billingService.getSubscription(req.user.tenantId);

    if (!subscription || !ACTIVE_STATUSES.includes(subscription.status)) {
      throw new ForbiddenError(
        'Assinatura inativa. Regularize o pagamento para continuar usando o sistema.',
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
