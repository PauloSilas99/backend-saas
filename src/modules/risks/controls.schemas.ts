import { z } from 'zod';
import { ControlStatus } from '@prisma/client';

export const createControlSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  status: z.nativeEnum(ControlStatus).optional(),
  responsibleId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  evidence: z.string().optional(),
});

export const updateControlSchema = createControlSchema.partial().extend({
  completedAt: z.string().datetime().optional().nullable(),
});

export type CreateControlInput = z.infer<typeof createControlSchema>;
export type UpdateControlInput = z.infer<typeof updateControlSchema>;
