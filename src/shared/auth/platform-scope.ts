/** Placeholder no JWT: admin da plataforma não pertence a uma empresa. */
export const PLATFORM_ACTOR_TENANT_ID = '00000000-0000-0000-0000-000000000000';
export const PLATFORM_ACTOR_MEMBERSHIP_ID = '00000000-0000-0000-0000-000000000000';

export function isPlatformScopeTenantId(tenantId: string | null | undefined): boolean {
  return !tenantId || tenantId === PLATFORM_ACTOR_TENANT_ID;
}
