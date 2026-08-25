import 'reflect-metadata';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role, SubscriptionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

dotenv.config();

const EMAIL = 'jhonata@saas.local';
const NAME = 'Jhonata';
const PASSWORD = 'jhon123@';
const WHATSAPP = '9888258534';
const TENANT_NAME = 'Avelino e Garces';
const TENANT_SLUG = 'avelino-e-garces';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 4,
    statement_timeout: 60_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const starter = await prisma.plan.findFirst({ where: { code: 'starter', isActive: true } });

  const existingUser = await prisma.user.findUnique({ where: { email: EMAIL } });
  let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: TENANT_NAME, slug: TENANT_SLUG, document: WHATSAPP, isActive: true },
    });
  } else {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { name: TENANT_NAME, isActive: true },
    });
  }

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: NAME,
          passwordHash,
          whatsapp: WHATSAPP,
          isActive: true,
          emailVerifiedAt: new Date(),
        },
      })
    : await prisma.user.create({
        data: {
          email: EMAIL,
          name: NAME,
          passwordHash,
          whatsapp: WHATSAPP,
          isActive: true,
          emailVerifiedAt: new Date(),
        },
      });

  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    update: { role: Role.GERENTE, isActive: true },
    create: { userId: user.id, tenantId: tenant.id, role: Role.GERENTE, isActive: true },
  });

  if (starter) {
    await prisma.subscription.upsert({
      where: { tenantId: tenant.id },
      update: {
        planId: starter.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      create: {
        tenantId: tenant.id,
        planId: starter.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  await prisma.unit.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'São José de Ribamar' } },
    update: {},
    create: { tenantId: tenant.id, name: 'São José de Ribamar', code: 'SJR' },
  });

  const plans = await prisma.actionPlan.findMany({
    where: { tenantId: tenant.id },
    select: { id: true },
  });
  const planIds = plans.map((p) => p.id);

  if (planIds.length > 0) {
    await prisma.risk.updateMany({
      where: { tenantId: tenant.id, actionRowId: { not: null } },
      data: { actionRowId: null },
    });
    await prisma.import.updateMany({
      where: { tenantId: tenant.id, actionPlanId: { in: planIds } },
      data: { actionPlanId: null },
    });
    await prisma.actionPlan.deleteMany({ where: { tenantId: tenant.id } });
  }

  console.log(`Usuário pronto (sem planilha). Login: ${EMAIL} / ${PASSWORD}`);
  console.log(`WhatsApp: ${WHATSAPP}`);
  console.log(`Empresa: ${TENANT_NAME} (${TENANT_SLUG})`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
