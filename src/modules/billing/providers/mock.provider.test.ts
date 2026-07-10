import { describe, expect, it } from 'vitest';
import { MockBillingProvider } from '@modules/billing/providers/mock.provider';

describe('MockBillingProvider', () => {
  const provider = new MockBillingProvider();

  it('creates checkout session', async () => {
    const result = await provider.createCheckout({
      planCode: 'starter',
      successUrl: 'https://app.local/success',
      cancelUrl: 'https://app.local/cancel',
      customerEmail: 'a@b.com',
      customerName: 'Test',
      tenantId: 'tenant-1',
      tenantName: 'Tenant',
    });

    expect(result.checkoutUrl).toContain('subscription_id=');
    expect(result.externalSubscriptionId).toMatch(/^sub_mock_/);
  });

  it('parses webhook payload', async () => {
    const event = await provider.parseWebhook({
      type: 'subscription.activated',
      tenantId: 'tenant-1',
      externalSubscriptionId: 'sub_1',
    });

    expect(event.type).toBe('subscription.activated');
    expect(event.tenantId).toBe('tenant-1');
  });
});
