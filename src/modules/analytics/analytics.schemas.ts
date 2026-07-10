import { z } from 'zod';

export const analyticsFilterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  unitId: z.string().uuid().optional(),
  responsibleId: z.string().uuid().optional(),
  status: z.string().optional(),
  tenantId: z.string().uuid().optional(),
});

export type AnalyticsFilterInput = z.infer<typeof analyticsFilterSchema>;
