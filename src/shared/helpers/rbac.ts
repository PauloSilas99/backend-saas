import { Role } from '@prisma/client';
import { AuthUser } from '@/types/auth';

export const ROLE_HIERARCHY: Record<Role, number> = {
  PLATFORM_ADMIN: 5,
  GERENTE: 4,
  GESTOR: 3,
  OPERACIONAL: 2,
  LEITOR: 1,
};

/** Roles that manage company operational data (not platform admin). */
export const COMPANY_MANAGER_ROLES: Role[] = [Role.GERENTE, Role.GESTOR];

/** Roles that can import spreadsheets and manage structure. */
export const COMPANY_ADMIN_ROLES: Role[] = [Role.GERENTE];

export function hasRequiredRole(userRole: Role, allowed: Role[]): boolean {
  return allowed.includes(userRole);
}

export function isAtLeast(userRole: Role, minimum: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimum];
}

export function isPlatformAdmin(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.PLATFORM_ADMIN;
}

export function isCompanyManager(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE || actor.role === Role.GESTOR;
}

export function isOperacional(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.OPERACIONAL;
}

export function isLeitor(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.LEITOR;
}

export function isReadOnly(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.LEITOR;
}

/**
 * When the tenant has at least one active GESTOR, approvals go through GESTOR.
 * Gerente cannot resolve directly. Without a GESTOR (solo / micro), GERENTE resolves.
 */
export function canApproveActions(
  actor: AuthUser | { role: Role },
  tenantHasGestor: boolean,
): boolean {
  if (isReadOnly(actor)) return false;
  if (tenantHasGestor) {
    return actor.role === Role.GESTOR;
  }
  return actor.role === Role.GERENTE || actor.role === Role.GESTOR;
}

/**
 * Requesting completion: operacional/gerente/gestor can move toward done.
 * If tenant has gestor and actor is gerente/operacional → WAITING_APPROVAL.
 * If actor can approve → COMPLETED directly.
 */
export function resolveCompletionTargetStatus(
  actor: AuthUser | { role: Role },
  tenantHasGestor: boolean,
): 'WAITING_APPROVAL' | 'COMPLETED' {
  if (canApproveActions(actor, tenantHasGestor)) {
    return 'COMPLETED';
  }
  return 'WAITING_APPROVAL';
}

export function canManageColumns(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE;
}

export function canManageCompanySettings(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE || actor.role === Role.PLATFORM_ADMIN;
}

export function canCreateCompany(actor: AuthUser | { role: Role }): boolean {
  return (
    actor.role === Role.PLATFORM_ADMIN ||
    actor.role === Role.GERENTE ||
    actor.role === Role.GESTOR
  );
}

export function canCreateActions(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE || actor.role === Role.GESTOR;
}

export function canEditAnyAction(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE || actor.role === Role.GESTOR;
}

export function canDeleteOrDuplicateAction(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE || actor.role === Role.GESTOR;
}

export function canImportSpreadsheet(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE || actor.role === Role.GESTOR;
}

export function canViewAllCompanyActions(actor: AuthUser | { role: Role }): boolean {
  return (
    actor.role === Role.GERENTE ||
    actor.role === Role.GESTOR ||
    actor.role === Role.LEITOR
  );
}

export function canManageUsers(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE;
}

/** Gerente da empresa ou admin da plataforma (equipe em Empresas). */
export function canManageCompanyTeam(actor: AuthUser | { role: Role }): boolean {
  return actor.role === Role.GERENTE || actor.role === Role.PLATFORM_ADMIN;
}

export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (targetRole === Role.PLATFORM_ADMIN) return false;
  if (actorRole === Role.PLATFORM_ADMIN) return true;
  if (actorRole !== Role.GERENTE) return false;
  return true;
}
