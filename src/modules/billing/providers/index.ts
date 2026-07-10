import { env } from '@config/env';
import { BillingProvider } from './billing-provider';
import { MockBillingProvider } from './mock.provider';
import { StripeBillingProvider } from './stripe.provider';

export function createBillingProvider(): BillingProvider {
  switch (env.BILLING_PROVIDER) {
    case 'stripe':
      return new StripeBillingProvider();
    case 'asaas':
    case 'mock':
    default:
      return new MockBillingProvider();
  }
}
