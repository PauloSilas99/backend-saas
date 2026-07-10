import { z } from 'zod';
import { ActionPriority, ActionStatus } from '@prisma/client';

export const createActionPlanSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  unitId: z.string().uuid().optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(1).max(12).optional(),
});

export const createActionRowSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  unitId: z.string().uuid().optional(),
  responsibleId: z.string().uuid().optional(),
  status: z.nativeEnum(ActionStatus).optional(),
  priority: z.nativeEnum(ActionPriority).optional(),
  dueDate: z.string().datetime().optional(),
  externalKey: z.string().optional(),
});

export const updateActionRowSchema = createActionRowSchema.partial();

export type CreateActionPlanInput = z.infer<typeof createActionPlanSchema>;
export type CreateActionRowInput = z.infer<typeof createActionRowSchema>;
export type UpdateActionRowInput = z.infer<typeof updateActionRowSchema>;
