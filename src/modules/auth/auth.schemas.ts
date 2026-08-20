import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  /** WhatsApp com DDI, só dígitos (ex.: 5511999998888). */
  whatsapp: z
    .string()
    .min(10)
    .max(20)
    .regex(/^\+?[0-9\s()-]+$/, 'Informe um WhatsApp válido')
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length >= 10 && v.length <= 15, {
      message: 'WhatsApp deve ter entre 10 e 15 dígitos',
    }),
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

export const verifyEmailSchema = z.object({
  token: z.string().min(20),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8).max(72),
});

export const updateMeSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).max(72).optional(),
  })
  .superRefine((data, ctx) => {
    const changingPassword = Boolean(data.currentPassword || data.newPassword);
    if (changingPassword && (!data.currentPassword || !data.newPassword)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Para trocar a senha, informe a senha atual e a nova',
      });
    }
    if (!data.name?.trim() && !changingPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe nome e/ou senha para atualizar',
      });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
