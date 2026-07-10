import { randomUUID } from 'crypto';
import { SubscriptionStatus } from '@prisma/client';
import {
  BillingProvider,
  CheckoutInput,
  CheckoutResult,
  PortalInput,
  PortalResult,
  WebhookEvent,
} from './billing-provider';

/**
 * Mock provider for local/dev. Simulates Stripe/Asaas checkout + webhooks.
 */
export class MockBillingProvider implements BillingProvider {
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const externalSubscriptionId = `sub_mock_${randomUUID()}`;
    const externalSessionId = `cs_mock_${randomUUID()}`;
    const checkoutUrl = `${input.successUrl}?session_id=${externalSessionId}&subscription_id=${externalSubscriptionId}&tenant_id=${input.tenantId}&plan=${input.planCode}`;

    return {
      checkoutUrl,
      externalSubscriptionId,
      externalSessionId,
    };
  }

  async createPortal(input: PortalInput): Promise<PortalResult> {
    return {
      portalUrl: `${input.returnUrl}?portal=mock&email=${encodeURIComponent(input.customerEmail)}`,
    };
  }

  async parseWebhook(payload: unknown): Promise<WebhookEvent> {
    const body = payload as Record<string, unknown>;
    const type = String(body.type ?? 'subscription.activated') as WebhookEvent['type'];

    return {
      type,
      externalSubscriptionId: body.externalSubscriptionId as string | undefined,
      externalPaymentId: body.externalPaymentId as string | undefined,
      tenantId: body.tenantId as string | undefined,
      planCode: body.planCode as string | undefined,
      amountCents: body.amountCents as number | undefined,
      status: body.status as SubscriptionStatus | undefined,
      raw: payload,
    };
  }
}
