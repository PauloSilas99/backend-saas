import 'reflect-metadata';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { assignCanonicalKeys } from '../src/modules/columns/canonical-backfill';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const plans = await prisma.actionPlan.findMany({ select: { id: true, title: true } });
  let matched = 0;
  let unmatched = 0;

  for (const plan of plans) {
    const columns = await prisma.actionColumn.findMany({
      where: { actionPlanId: plan.id, deletedAt: null },
      select: { id: true, label: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    const assignments = assignCanonicalKeys(columns);
    for (const assignment of assignments) {
      if (assignment.canonicalKey) matched += 1;
      else unmatched += 1;
      await prisma.actionColumn.update({
        where: { id: assignment.id },
        data: { canonicalKey: assignment.canonicalKey },
      });
    }

    const semKey = assignments.filter((a) => !a.canonicalKey).length;
    console.log(
      `plano ${plan.id} (${plan.title}): ${assignments.length - semKey}/${assignments.length} casadas`,
    );
  }

  console.log(`\ntotal: ${matched} casadas, ${unmatched} seguem dinâmicas`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
