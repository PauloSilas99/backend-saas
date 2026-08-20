import 'reflect-metadata';
import dotenv from 'dotenv';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@saas.local';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
  const adminName = process.env.ADMIN_NAME ?? 'Platform Admin';
  const gerenteEmail = process.env.GESTOR_EMAIL ?? 'gestor@saas.local';
  const gerentePassword = process.env.GESTOR_PASSWORD ?? 'Gestor@123456';
  const operacionalEmail = process.env.OPERACIONAL_EMAIL ?? 'operacional@saas.local';
  const operacionalPassword = process.env.OPERACIONAL_PASSWORD ?? 'Operacional@123456';
  const aprovadorEmail = 'aprovador@saas.local';
  const aprovadorPassword = 'Aprovador@123456';

  const plan = await prisma.plan.upsert({
    where: { code: 'starter' },
    update: {},
    create: {
      name: 'Starter',
      code: 'starter',
      description: 'Plano inicial para pequenas equipes',
      priceCents: 9900,
      currency: 'BRL',
      interval: 'month',
      features: { maxUsers: 10, maxUnits: 5, analytics: true },
      isActive: true,
      externalId: 'plan_starter',
    },
  });

  await prisma.plan.upsert({
    where: { code: 'pro' },
    update: {},
    create: {
      name: 'Pro',
      code: 'pro',
      description: 'Plano profissional com recursos avançados',
      priceCents: 19900,
      currency: 'BRL',
      interval: 'month',
      features: { maxUsers: 50, maxUnits: 20, analytics: true, imports: true },
      isActive: true,
      externalId: 'plan_pro',
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-company' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo-company',
      document: '00.000.000/0001-00',
      isActive: true,
    },
  });

  const unitMatriz = await prisma.unit.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Matriz' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Matriz',
      code: 'MTZ',
    },
  });

  const unitFilial = await prisma.unit.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Filial SP' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Filial SP',
      code: 'SP01',
    },
  });

  const adminHash = await bcrypt.hash(adminPassword, 10);
  const gerenteHash = await bcrypt.hash(gerentePassword, 10);
  const operacionalHash = await bcrypt.hash(operacionalPassword, 10);
  const aprovadorHash = await bcrypt.hash(aprovadorPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: adminHash,
      name: adminName,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: adminEmail,
      passwordHash: adminHash,
      name: adminName,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  const gerente = await prisma.user.upsert({
    where: { email: gerenteEmail },
    update: {
      passwordHash: gerenteHash,
      name: 'Gerente Demo',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: gerenteEmail,
      passwordHash: gerenteHash,
      name: 'Gerente Demo',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  const gestor = await prisma.user.upsert({
    where: { email: aprovadorEmail },
    update: {
      passwordHash: aprovadorHash,
      name: 'Gestor Aprovador',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: aprovadorEmail,
      passwordHash: aprovadorHash,
      name: 'Gestor Aprovador',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  const operacional = await prisma.user.upsert({
    where: { email: operacionalEmail },
    update: {
      passwordHash: operacionalHash,
      name: 'Operacional Demo',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: operacionalEmail,
      passwordHash: operacionalHash,
      name: 'Operacional Demo',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: admin.id, tenantId: tenant.id } },
    update: { role: Role.PLATFORM_ADMIN, isActive: true },
    create: { userId: admin.id, tenantId: tenant.id, role: Role.PLATFORM_ADMIN },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: gerente.id, tenantId: tenant.id } },
    update: { role: Role.GERENTE, isActive: true },
    create: { userId: gerente.id, tenantId: tenant.id, role: Role.GERENTE },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: gestor.id, tenantId: tenant.id } },
    update: { role: Role.GESTOR, isActive: true },
    create: { userId: gestor.id, tenantId: tenant.id, role: Role.GESTOR },
  });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: operacional.id, tenantId: tenant.id } },
    update: { role: Role.OPERACIONAL, isActive: true },
    create: {
      userId: operacional.id,
      tenantId: tenant.id,
      role: Role.OPERACIONAL,
    },
  });

  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: {
      status: SubscriptionStatus.ACTIVE,
      planId: plan.id,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      tenantId: tenant.id,
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      externalId: 'sub_demo_active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const existingPlan = await prisma.actionPlan.findFirst({
    where: { tenantId: tenant.id, title: 'Plano de Ação 2026' },
  });

  let actionPlan = existingPlan;
  if (!actionPlan) {
    actionPlan = await prisma.actionPlan.create({
      data: {
        tenantId: tenant.id,
        unitId: unitMatriz.id,
        ownerId: gerente.id,
        title: 'Plano de Ação 2026',
        description: 'Plano de ação demo para analytics',
        year: 2026,
        month: 7,
      },
    });

    await prisma.actionPlanRow.createMany({
      data: [
        {
          actionPlanId: actionPlan.id,
          unitId: unitMatriz.id,
          responsibleId: operacional.id,
          externalKey: 'demo-1',
          title: 'Revisar processos internos',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          dueDate: new Date('2026-07-20'),
          responsibleName: 'Operacional Demo',
          unitName: 'Matriz',
        },
        {
          actionPlanId: actionPlan.id,
          unitId: unitFilial.id,
          responsibleId: operacional.id,
          externalKey: 'demo-2',
          title: 'Treinar equipe comercial',
          status: 'PENDING',
          priority: 'MEDIUM',
          dueDate: new Date('2026-07-25'),
          responsibleName: 'Operacional Demo',
          unitName: 'Filial SP',
        },
        {
          actionPlanId: actionPlan.id,
          unitId: unitMatriz.id,
          responsibleId: gestor.id,
          externalKey: 'demo-3',
          title: 'Atualizar indicadores KPI',
          status: 'COMPLETED',
          priority: 'CRITICAL',
          dueDate: new Date('2026-07-05'),
          completedAt: new Date('2026-07-04'),
          responsibleName: 'Gestor Aprovador',
          unitName: 'Matriz',
        },
        {
          actionPlanId: actionPlan.id,
          unitId: unitFilial.id,
          responsibleId: operacional.id,
          externalKey: 'demo-4',
          title: 'Auditar estoque',
          status: 'DELAYED',
          priority: 'HIGH',
          dueDate: new Date('2026-07-01'),
          responsibleName: 'Operacional Demo',
          unitName: 'Filial SP',
        },
      ],
    });
  }

  console.log('Seed completed successfully');
  console.log({
    platformAdmin: adminEmail,
    gerente: gerenteEmail,
    gestor: aprovadorEmail,
    operacional: operacionalEmail,
    tenant: tenant.slug,
    plan: plan.code,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
