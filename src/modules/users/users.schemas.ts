import { z } from 'zod';
import { parseRoleInput, feRoleSchemaValues } from '@shared/helpers/roles';

const roleInput = z
  .union([z.enum(feRoleSchemaValues as unknown as [string, ...string[]]), z.string()])
  .transform((v) => parseRoleInput(v));

export const createUserSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8).max(72).optional(),
    role: roleInput.optional(),
    cargo: roleInput.optional(),
  })
  .transform((data) => {
    const role = data.role ?? data.cargo;
    if (!role) {
      throw new z.ZodError([
        {
          code: 'custom',
          message: 'role ou cargo é obrigatório',
          path: ['role'],
        },
      ]);
    }
    return {
      name: data.name,
      email: data.email,
      password: data.password,
      role,
    };
  });

export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    isActive: z.boolean().optional(),
    role: roleInput.optional(),
    cargo: roleInput.optional(),
  })
  .transform((data) => ({
    name: data.name,
    isActive: data.isActive,
    role: data.role ?? data.cargo,
  }));

export const listUsersQuerySchema = z.object({
  q: z.string().optional(),
});

export const setUserActiveSchema = z.object({
  isActive: z.boolean(),
});

export type CreateUserInput = {
  name: string;
  email: string;
  password?: string;
  role: import('@prisma/client').Role;
};
export type UpdateUserInput = {
  name?: string;
  isActive?: boolean;
  role?: import('@prisma/client').Role;
};
