import { Role } from '@prisma/client';

export const ROLE_HIERARCHY: Record<Role, number> = {
  ADMIN: 3,
  GESTOR: 2,
  OPERACIONAL: 1,
};

export function hasRequiredRole(userRole: Role, allowed: Role[]): boolean {
  return allowed.includes(userRole);
}

export function isAtLeast(userRole: Role, minimum: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimum];
}
