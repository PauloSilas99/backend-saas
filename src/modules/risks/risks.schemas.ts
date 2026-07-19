import { z } from 'zod';
import { RiskLevel, RiskStatus } from '@prisma/client';

export const createRiskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().optional(),
  actionRowId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  probability: z.nativeEnum(RiskLevel).optional(),
  impact: z.nativeEnum(RiskLevel).optional(),
  severity: z.nativeEnum(RiskLevel).optional(),
  status: z.nativeEnum(RiskStatus).optional(),
  mitigationPlan: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});

export const updateRiskSchema = createRiskSchema.partial();

export const listRisksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.nativeEnum(RiskStatus).optional(),
  search: z.string().optional(),
});

export type CreateRiskInput = z.infer<typeof createRiskSchema>;
export type UpdateRiskInput = z.infer<typeof updateRiskSchema>;
export type ListRisksQuery = z.infer<typeof listRisksQuerySchema>;
