import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  tenantName: z.string().min(2).max(120).optional(),
  tenantSlug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantSlug: z.string().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
  tenantId: z.string().uuid().optional(),
});

export const switchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;
