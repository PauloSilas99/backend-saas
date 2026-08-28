import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext } from './tenant-context';

const TENANT_ID_MODELS = new Set<string>([
  'Membership',
  'Unit',
  'ActionPlan',
  'ActionColumn',
  'Import',
  'Risk',
  'CalendarActivity',
  'CalendarOverride',
  'CalendarActionOverlay',
  'ActionEvidence',
  'Subscription',
  'Payment',
  'AuditLog',
]);

const WRITE_OPS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

function withTenantWhere(args: Record<string, unknown>, tenantId: string) {
  const where = (args.where as Record<string, unknown> | undefined) ?? {};
  if (where.tenantId !== undefined) return args;
  args.where = { ...where, tenantId };
  return args;
}

function withTenantData(args: Record<string, unknown>, tenantId: string) {
  const data = args.data as Record<string, unknown> | undefined;
  if (!data) return args;
  if (Array.isArray(data)) {
    args.data = data.map((row) =>
      row && typeof row === 'object' && (row as { tenantId?: string }).tenantId === undefined
        ? { ...row, tenantId }
        : row,
    );
    return args;
  }
  if (data.tenantId === undefined) {
    args.data = { ...data, tenantId };
  }
  return args;
}

export async function setTransactionTenant(
  tx: { $executeRaw: (query: TemplateStringsArray, ...values: string[]) => Promise<unknown> },
  tenantId: string,
) {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

export function applyTenantExtension<T extends PrismaClient>(client: T) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const store = getTenantContext();
          if (!store || store.bypass || !model || !TENANT_ID_MODELS.has(model)) {
            return query(args);
          }

          const nextArgs = { ...(args as Record<string, unknown>) };
          if (operation === 'create' || operation === 'createMany' || operation === 'upsert') {
            withTenantData(nextArgs, store.tenantId);
          }
          if (
            operation.startsWith('find') ||
            operation === 'count' ||
            operation === 'aggregate' ||
            operation === 'groupBy' ||
            WRITE_OPS.has(operation)
          ) {
            if (operation !== 'create' && operation !== 'createMany') {
              withTenantWhere(nextArgs, store.tenantId);
            }
          }

          return query(nextArgs as typeof args);
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof applyTenantExtension>;

export { Prisma };
