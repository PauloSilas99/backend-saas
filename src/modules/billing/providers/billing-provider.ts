import { SubscriptionStatus } from '@prisma/client';

export interface CheckoutInput {
  planCode: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  customerName: string;
  tenantId: string;
  tenantName: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  externalSubscriptionId: string;
  externalSessionId: string;
}

export interface PortalInput {
  customerEmail: string;
  returnUrl: string;
  externalSubscriptionId?: string | null;
}

export interface PortalResult {
  portalUrl: string;
}

export interface WebhookEvent {
  type:
    | 'subscription.activated'
    | 'subscription.canceled'
    | 'subscription.past_due'
    | 'payment.paid'
    | 'payment.failed';
  externalSubscriptionId?: string;
  externalPaymentId?: string;
  tenantId?: string;
  planCode?: string;
  amountCents?: number;
  status?: SubscriptionStatus;
  raw: unknown;
}

export interface BillingProvider {
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  createPortal(input: PortalInput): Promise<PortalResult>;
  parseWebhook(payload: unknown, signature?: string): Promise<WebhookEvent>;
}
