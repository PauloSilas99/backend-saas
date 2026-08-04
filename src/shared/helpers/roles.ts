import { Role } from '@prisma/client';
import { ValidationError } from '@shared/errors/AppError';

/** FE roles → Prisma Role */
const FE_ROLE_MAP: Record<string, Role> = {
  admin: Role.PLATFORM_ADMIN,
  platform_admin: Role.PLATFORM_ADMIN,
  gerente: Role.GERENTE,
  gestor: Role.GESTOR,
  operacional: Role.OPERACIONAL,
  leitor: Role.LEITOR,
};

/** Prisma Role → FE label */
const TO_FE_ROLE: Record<Role, string> = {
  PLATFORM_ADMIN: 'admin',
  GERENTE: 'gerente',
  GESTOR: 'gestor',
  OPERACIONAL: 'operacional',
  LEITOR: 'leitor',
};

export function parseRoleInput(value: string | Role): Role {
  if (Object.values(Role).includes(value as Role)) {
    return value as Role;
  }
  const mapped = FE_ROLE_MAP[String(value).toLowerCase().trim()];
  if (!mapped) {
    throw new ValidationError(`Role inválida: ${value}`);
  }
  return mapped;
}

export function toFeRole(role: Role): string {
  return TO_FE_ROLE[role] ?? role.toLowerCase();
}

export const feRoleSchemaValues = [
  'admin',
  'gerente',
  'gestor',
  'operacional',
  'leitor',
  ...Object.values(Role),
] as const;
