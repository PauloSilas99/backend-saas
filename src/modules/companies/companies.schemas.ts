import { z } from 'zod';

export const createCompanySchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  document: z.string().optional(),
});

export const updateCompanySchema = z.object({
  name: z.string().min(2).max(120).optional(),
  document: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const createUnitSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(30).optional(),
  empresaId: z.string().uuid().optional(),
});

export const updateUnitSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  code: z.string().max(30).optional(),
  isActive: z.boolean().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
