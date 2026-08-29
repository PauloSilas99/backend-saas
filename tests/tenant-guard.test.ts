import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma as appPrisma } from '@config/database';
import { runWithTenant } from '@shared/tenancy/tenant-context';
import {
  disconnect,
  dropTenant,
  prisma,
  seedSheetWithRow,
  seedTenant,
  type SeededTenant,
} from './helpers/fixture';

let alpha: SeededTenant;
let beta: SeededTenant;
let betaSheet: { planId: string; rowId: string; columnId: string };

beforeAll(async () => {
  alpha = await seedTenant('guard-alpha', []);
  beta = await seedTenant('guard-beta');
  betaSheet = await seedSheetWithRow(beta, beta.users.GERENTE.id);
}, 60_000);

afterAll(async () => {
  await dropTenant(alpha.id);
  await dropTenant(beta.id);
  await disconnect();
});

describe('rede de segurança do tenant na linha', () => {
  it('escrita por id, no contexto da empresa errada, não encontra a linha', async () => {
    await expect(
      runWithTenant({ tenantId: alpha.id, bypass: false }, async () => {
        await appPrisma.actionPlanRow.update({
          where: { id: betaSheet.rowId },
          data: { title: 'sequestrada' },
        });
      }),
    ).rejects.toThrow();

    const row = await prisma.actionPlanRow.findUnique({ where: { id: betaSheet.rowId } });
    expect(row?.title).toBe('Ação de teste');
  });

  it('leitura por id, no contexto errado, devolve nada', async () => {
    const achada = await runWithTenant({ tenantId: alpha.id, bypass: false }, async () =>
      appPrisma.actionPlanRow.findFirst({ where: { id: betaSheet.rowId } }),
    );
    expect(achada).toBeNull();
  });

  it('no contexto certo, a mesma chamada funciona', async () => {
    const achada = await runWithTenant({ tenantId: beta.id, bypass: false }, async () =>
      appPrisma.actionPlanRow.findFirst({ where: { id: betaSheet.rowId } }),
    );
    expect(achada?.id).toBe(betaSheet.rowId);
  });

  it('contagem não vaza linhas de outra empresa', async () => {
    const total = await runWithTenant({ tenantId: alpha.id, bypass: false }, async () =>
      appPrisma.actionPlanRow.count(),
    );
    expect(total).toBe(0);
  });
});
