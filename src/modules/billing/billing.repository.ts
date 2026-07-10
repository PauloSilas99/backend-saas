import { inject, injectable } from 'tsyringe';
import {
  PaymentStatus,
  Prisma,
  PrismaClient,
  SubscriptionStatus,
} from '@prisma/client';

@injectable()
export class BillingRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  findPlanByCode(code: string) {
    return this.prisma.plan.findUnique({ where: { code } });
  }

  listPlans() {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: 'asc' } });
  }

  findSubscriptionByTenant(tenantId: string) {
    return this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
  }

  findSubscriptionByExternalId(externalId: string) {
    return this.prisma.subscription.findFirst({
      where: { externalId },
      include: { plan: true },
    });
  }

  upsertSubscription(data: {
    tenantId: string;
    planId: string;
    status: SubscriptionStatus;
    externalId?: string;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
  }) {
    return this.prisma.subscription.upsert({
      where: { tenantId: data.tenantId },
      update: {
        planId: data.planId,
        status: data.status,
        externalId: data.externalId,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
      },
      create: data,
      include: { plan: true },
    });
  }

  updateSubscriptionStatus(
    tenantId: string,
    status: SubscriptionStatus,
    extra?: Prisma.SubscriptionUpdateInput,
  ) {
    return this.prisma.subscription.update({
      where: { tenantId },
      data: { status, ...extra },
      include: { plan: true },
    });
  }

  createPayment(data: {
    tenantId: string;
    subscriptionId?: string;
    amountCents: number;
    status: PaymentStatus;
    externalId?: string;
    paidAt?: Date;
    metadata?: Prisma.InputJsonValue;
  }) {
    return this.prisma.payment.create({ data });
  }
}
