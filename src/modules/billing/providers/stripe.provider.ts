import { randomUUID } from 'crypto';
import { env } from '@config/env';
import { AppError } from '@shared/errors/AppError';
import {
  BillingProvider,
  CheckoutInput,
  CheckoutResult,
  PortalInput,
  PortalResult,
  WebhookEvent,
} from './billing-provider';

/**
 * Stripe adapter skeleton. Uses fetch against Stripe API when STRIPE_SECRET_KEY is set.
 * Falls back to mock-like behavior if key is missing (keeps webhook contract intact).
 */
export class StripeBillingProvider implements BillingProvider {
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!env.STRIPE_SECRET_KEY) {
      const externalSubscriptionId = `sub_stripe_dev_${randomUUID()}`;
      return {
        checkoutUrl: `${input.successUrl}?provider=stripe&subscription_id=${externalSubscriptionId}`,
        externalSubscriptionId,
        externalSessionId: `cs_stripe_dev_${randomUUID()}`,
      };
    }

    // Minimal Stripe Checkout Session creation via REST
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('success_url', input.successUrl);
    params.append('cancel_url', input.cancelUrl);
    params.append('customer_email', input.customerEmail);
    params.append('metadata[tenantId]', input.tenantId);
    params.append('metadata[planCode]', input.planCode);
    params.append('line_items[0][price_data][currency]', 'brl');
    params.append('line_items[0][price_data][product_data][name]', input.planCode);
    params.append('line_items[0][price_data][unit_amount]', '9900');
    params.append('line_items[0][price_data][recurring][interval]', 'month');
    params.append('line_items[0][quantity]', '1');

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new AppError(`Stripe checkout failed: ${text}`, 502, 'BILLING_PROVIDER_ERROR');
    }

    const data = (await response.json()) as {
      id: string;
      url: string;
      subscription?: string;
    };

    return {
      checkoutUrl: data.url,
      externalSessionId: data.id,
      externalSubscriptionId: data.subscription ?? `sub_pending_${data.id}`,
    };
  }

  async createPortal(input: PortalInput): Promise<PortalResult> {
    return {
      portalUrl: `${input.returnUrl}?provider=stripe-portal`,
    };
  }

  async parseWebhook(payload: unknown, signature?: string): Promise<WebhookEvent> {
    if (env.STRIPE_WEBHOOK_SECRET && !signature) {
      throw new AppError('Assinatura do webhook ausente', 401, 'WEBHOOK_UNAUTHORIZED');
    }

    const body = payload as {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };

    const object = body.data?.object ?? {};
    const stripeType = body.type ?? '';

    const map: Record<string, WebhookEvent['type']> = {
      'checkout.session.completed': 'subscription.activated',
      'customer.subscription.updated': 'subscription.activated',
      'customer.subscription.deleted': 'subscription.canceled',
      'invoice.payment_failed': 'subscription.past_due',
      'invoice.paid': 'payment.paid',
    };

    return {
      type: map[stripeType] ?? 'subscription.activated',
      externalSubscriptionId: (object.subscription as string) ?? (object.id as string),
      externalPaymentId: object.id as string | undefined,
      tenantId: (object.metadata as Record<string, string> | undefined)?.tenantId,
      planCode: (object.metadata as Record<string, string> | undefined)?.planCode,
      amountCents: object.amount_total as number | undefined,
      raw: payload,
    };
  }
}
