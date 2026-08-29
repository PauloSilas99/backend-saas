import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ActionStatus, Role } from '@prisma/client';
import { app } from '@/app';
import {
  disconnect,
  dropTenant,
  prisma,
  seedSheetWithRow,
  seedTenant,
  type SeededTenant,
} from './helpers/fixture';

const API = '/api/v1';

let empresa: SeededTenant;
let sheet: { planId: string; rowId: string; columnId: string };

function auth(role: Role) {
  return { Authorization: `Bearer ${empresa.users[role].token}` };
}

async function novaLinha(sufixo: string) {
  return prisma.actionPlanRow.create({
    data: {
      tenantId: empresa.id,
      actionPlanId: sheet.planId,
      title: `Acao ${sufixo}`,
      externalKey: `AP-${sufixo}`,
      status: ActionStatus.IN_PROGRESS,
    },
  });
}

beforeAll(async () => {
  empresa = await seedTenant('aprovacao');
  sheet = await seedSheetWithRow(empresa, empresa.users.GERENTE.id);
}, 60_000);

afterAll(async () => {
  await dropTenant(empresa.id);
  await disconnect();
});

describe('fluxo de aprovação — comportamento atual, ainda em análise pelo cliente', () => {
  it('com gestor ativo, o gerente que solicita conclusão fica aguardando aprovação', async () => {
    const linha = await novaLinha('req');
    const res = await request(app)
      .post(`${API}/action-plans/rows/${linha.id}/request-completion`)
      .set(auth(Role.GERENTE))
      .send({});

    expect(res.status).toBe(200);
    const depois = await prisma.actionPlanRow.findUnique({ where: { id: linha.id } });
    expect(depois!.status).toBe(ActionStatus.WAITING_APPROVAL);
  });

  it('mas resolver pela planilha conclui direto, sem passar pela aprovação', async () => {
    const linha = await novaLinha('resolve');
    const res = await request(app)
      .post(`${API}/action-plan-sheets/${sheet.planId}/rows/${linha.id}/resolve`)
      .set(auth(Role.GERENTE))
      .send({ completedAt: '2026-08-28T12:00:00.000Z' });

    expect(res.status).toBe(200);
    const depois = await prisma.actionPlanRow.findUnique({ where: { id: linha.id } });
    expect(depois!.status).toBe(ActionStatus.COMPLETED);
  });
});
