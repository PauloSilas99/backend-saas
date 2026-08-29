import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { app } from '@/app';
import { pgSslFor } from '@config/pg-ssl';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function assertLocalDatabase(): string {
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Teste de integração recusado: DATABASE_URL aponta para "${host || 'destino ilegível'}". ` +
        'Rode com um banco local, nunca contra o ambiente do cliente.',
    );
  }
  return url;
}

const pool = new Pool({
  connectionString: assertLocalDatabase(),
  ssl: pgSslFor(process.env.DATABASE_URL ?? ''),
});
export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export type SeededUser = {
  id: string;
  email: string;
  password: string;
  role: Role;
  token: string;
};

export type SeededTenant = {
  id: string;
  slug: string;
  planId: string;
  users: Record<string, SeededUser>;
};

const PASSWORD = 'Teste@123456';

export async function login(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD });
  if (response.status !== 200) {
    throw new Error(`Login falhou para ${email}: ${response.status} ${response.text}`);
  }
  return response.body.data.accessToken as string;
}

async function ensurePlan(): Promise<string> {
  const plan = await prisma.plan.upsert({
    where: { code: 'integration' },
    update: {},
    create: {
      name: 'Integration',
      code: 'integration',
      priceCents: 0,
      currency: 'BRL',
      interval: 'month',
      isActive: true,
    },
  });
  return plan.id;
}

export async function seedTenant(
  label: string,
  roles: Role[] = [Role.GERENTE, Role.GESTOR, Role.OPERACIONAL, Role.LEITOR],
): Promise<SeededTenant> {
  const planId = await ensurePlan();
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({
    data: { name: label, slug, isActive: true },
  });

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const passwordHash = await bcrypt.hash(PASSWORD, 8);
  const users: Record<string, SeededUser> = {};

  for (const role of roles) {
    const email = `${role.toLowerCase()}.${slug}@teste.local`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `${role} ${label}`,
        passwordHash,
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role, isActive: true },
    });
    users[role] = {
      id: user.id,
      email,
      password: PASSWORD,
      role,
      token: await login(email),
    };
  }

  return { id: tenant.id, slug, planId, users };
}

export async function dropTenant(tenantId: string): Promise<void> {
  const memberships = await prisma.membership.findMany({
    where: { tenantId },
    select: { userId: true },
  });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.user.deleteMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
  });
}

export async function seedSheetWithRow(tenant: SeededTenant, ownerId: string) {
  const plan = await prisma.actionPlan.create({
    data: { tenantId: tenant.id, ownerId, title: `Plano ${tenant.slug}` },
  });
  const column = await prisma.actionColumn.create({
    data: {
      tenantId: tenant.id,
      actionPlanId: plan.id,
      name: 'c_acoes',
      label: 'AÇÕES',
      canonicalKey: 'acoes',
      fieldType: 'TEXT',
      sortOrder: 0,
    },
  });
  const row = await prisma.actionPlanRow.create({
    data: {
      tenantId: tenant.id,
      actionPlanId: plan.id,
      externalKey: 'A-0001',
      title: 'Ação de teste',
      cells: { [column.id]: 'Ação de teste' },
    },
  });
  return { planId: plan.id, rowId: row.id, columnId: column.id };
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
