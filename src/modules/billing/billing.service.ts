import { inject, injectable } from 'tsyringe';
import { PaymentStatus, Role, SubscriptionStatus } from '@prisma/client';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@shared/errors/AppError';
import { AuditService } from '@shared/audit/audit.service';
import { AuthUser } from '@/types/auth';
import { BillingRepository } from './billing.repository';
import { BillingProvider } from './providers/billing-provider';
import { CheckoutBody, PortalBody } from './billing.schemas';

@injectable()
export class BillingService {
  constructor(
    @inject(BillingRepository) private readonly billingRepository: BillingRepository,
    @inject('BillingProvider') private readonly billingProvider: BillingProvider,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {}

  listPlans() {
    return this.billingRepository.listPlans();
  }

  async getSubscription(tenantId: string) {
    return this.billingRepository.findSubscriptionByTenant(tenantId);
  }

  async checkout(actor: AuthUser, input: CheckoutBody) {
    if (actor.role === Role.OPERACIONAL) {
      throw new ForbiddenError('Operacional não gerencia billing');
    }

    if (actor.role !== Role.GERENTE) {
      throw new ForbiddenError('Apenas gerente gerencia billing');
    }

    const plan = await this.billingRepository.findPlanByCode(input.planCode);
    if (!plan || !plan.isActive) {
      throw new NotFoundError('Plano não encontrado');
    }

    const result = await this.billingProvider.createCheckout({
      planCode: plan.code,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      customerEmail: actor.email,
      customerName: actor.name,
      tenantId: actor.tenantId,
      tenantName: actor.tenantId,
    });

    await this.billingRepository.upsertSubscription({
      tenantId: actor.tenantId,
      planId: plan.id,
      status: SubscriptionStatus.INACTIVE,
      externalId: result.externalSubscriptionId,
    });

    await this.auditService.log({
      tenantId: actor.tenantId,
      userId: actor.id,
      action: 'billing.checkout',
      resource: 'subscription',
      metadata: { planCode: plan.code, externalId: result.externalSubscriptionId },
    });

    return result;
  }

  async portal(actor: AuthUser, input: PortalBody) {
    if (actor.role !== Role.GERENTE) {
      throw new ForbiddenError('Apenas gerente gerencia billing');
    }

    const subscription = await this.billingRepository.findSubscriptionByTenant(actor.tenantId);
    return this.billingProvider.createPortal({
      customerEmail: actor.email,
      returnUrl: input.returnUrl,
      externalSubscriptionId: subscription?.externalId,
    });
  }

  async handleWebhook(payload: unknown, signature?: string) {
    const event = await this.billingProvider.parseWebhook(payload, signature);

    let subscription =
      (event.externalSubscriptionId
        ? await this.billingRepository.findSubscriptionByExternalId(event.externalSubscriptionId)
        : null) ??
      (event.tenantId
        ? await this.billingRepository.findSubscriptionByTenant(event.tenantId)
        : null);

    if (!subscription && event.tenantId && event.planCode) {
      const plan = await this.billingRepository.findPlanByCode(event.planCode);
      if (!plan) throw new ValidationError('Plano do webhook inválido');

      subscription = await this.billingRepository.upsertSubscription({
        tenantId: event.tenantId,
        planId: plan.id,
        status: SubscriptionStatus.INACTIVE,
        externalId: event.externalSubscriptionId,
      });
    }

    if (!subscription) {
      throw new NotFoundError('Assinatura não encontrada para o webhook');
    }

    switch (event.type) {
      case 'subscription.activated':
      case 'payment.paid': {
        const updated = await this.billingRepository.updateSubscriptionStatus(
          subscription.tenantId,
          SubscriptionStatus.ACTIVE,
          {
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            externalId: event.externalSubscriptionId ?? subscription.externalId,
          },
        );

        if (event.amountCents) {
          await this.billingRepository.createPayment({
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            amountCents: event.amountCents,
            status: PaymentStatus.PAID,
            externalId: event.externalPaymentId,
            paidAt: new Date(),
            metadata: event.raw as object,
          });
        }

        await this.auditService.log({
          tenantId: subscription.tenantId,
          action: 'billing.webhook.activated',
          resource: 'subscription',
          resourceId: subscription.id,
          metadata: event,
        });

        return updated;
      }
      case 'subscription.canceled': {
        const updated = await this.billingRepository.updateSubscriptionStatus(
          subscription.tenantId,
          SubscriptionStatus.CANCELED,
        );
        await this.auditService.log({
          tenantId: subscription.tenantId,
          action: 'billing.webhook.canceled',
          resource: 'subscription',
          resourceId: subscription.id,
        });
        return updated;
      }
      case 'subscription.past_due':
      case 'payment.failed': {
        const updated = await this.billingRepository.updateSubscriptionStatus(
          subscription.tenantId,
          SubscriptionStatus.PAST_DUE,
        );

        if (event.amountCents) {
          await this.billingRepository.createPayment({
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            amountCents: event.amountCents,
            status: PaymentStatus.FAILED,
            externalId: event.externalPaymentId,
            metadata: event.raw as object,
          });
        }

        await this.auditService.log({
          tenantId: subscription.tenantId,
          action: 'billing.webhook.past_due',
          resource: 'subscription',
          resourceId: subscription.id,
        });
        return updated;
      }
      default:
        return subscription;
    }
  }
}
