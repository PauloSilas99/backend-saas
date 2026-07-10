import { z } from 'zod';

export const checkoutSchema = z.object({
  planCode: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const portalSchema = z.object({
  returnUrl: z.string().url(),
});

export type CheckoutBody = z.infer<typeof checkoutSchema>;
export type PortalBody = z.infer<typeof portalSchema>;
