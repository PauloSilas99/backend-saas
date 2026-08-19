import { AsyncLocalStorage } from 'node:async_hooks';
import { Role } from '@prisma/client';

export type TenantStore = {
  tenantId: string;
  bypass: boolean;
};

const als = new AsyncLocalStorage<TenantStore>();

export function enterTenantContext(tenantId: string, role?: Role): void {
  als.enterWith({
    tenantId,
    bypass: role === Role.PLATFORM_ADMIN,
  });
}

export function getTenantContext(): TenantStore | undefined {
  return als.getStore();
}

export function runWithTenant<T>(store: TenantStore, fn: () => T): T {
  return als.run(store, fn);
}
