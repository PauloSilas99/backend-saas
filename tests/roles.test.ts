import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';
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

const PAPEIS = [Role.GERENTE, Role.GESTOR, Role.OPERACIONAL, Role.LEITOR];

function auth(role: Role) {
  return { Authorization: `Bearer ${empresa.users[role].token}` };
}

function permitido(status: number): boolean {
  return status >= 200 && status < 300;
}

beforeAll(async () => {
  empresa = await seedTenant('papeis');
  sheet = await seedSheetWithRow(empresa, empresa.users.GERENTE.id);
}, 60_000);

afterAll(async () => {
  await dropTenant(empresa.id);
  await disconnect();
});

async function matriz(
  executar: (role: Role) => Promise<{ status: number }>,
): Promise<Record<string, boolean>> {
  const resultado: Record<string, boolean> = {};
  for (const role of PAPEIS) {
    resultado[role] = permitido((await executar(role)).status);
  }
  return resultado;
}

describe('matriz de papéis', () => {
  it('ler a planilha é liberado para todos os perfis da empresa', async () => {
    const resultado = await matriz((role) =>
      request(app).get(`${API}/action-plan-sheets/${sheet.planId}`).set(auth(role)),
    );
    expect(resultado).toEqual({
      GERENTE: true,
      GESTOR: true,
      OPERACIONAL: true,
      LEITOR: true,
    });
  });

  it('criar ação é de gerente e gestor', async () => {
    const resultado = await matriz((role) =>
      request(app)
        .post(`${API}/action-plan-sheets/${sheet.planId}/rows`)
        .set(auth(role))
        .send({ title: `acao de ${role}` }),
    );
    expect(resultado).toEqual({
      GERENTE: true,
      GESTOR: true,
      OPERACIONAL: false,
      LEITOR: false,
    });
  });

  it('gerenciar colunas é só do gerente', async () => {
    const resultado = await matriz((role) =>
      request(app)
        .post(`${API}/action-plan-sheets/${sheet.planId}/columns`)
        .set(auth(role))
        .send({ name: `c_${role.toLowerCase()}`, label: `Col ${role}`, fieldType: 'TEXT' }),
    );
    expect(resultado).toEqual({
      GERENTE: true,
      GESTOR: false,
      OPERACIONAL: false,
      LEITOR: false,
    });
  });

  it('baixar o modelo é de quem importa', async () => {
    const resultado = await matriz((role) =>
      request(app).get(`${API}/action-plan-sheets/template`).set(auth(role)),
    );
    expect(resultado).toEqual({
      GERENTE: true,
      GESTOR: true,
      OPERACIONAL: false,
      LEITOR: false,
    });
  });

  it('excluir ação é de gerente e gestor', async () => {
    const alvo = await prisma.actionPlanRow.create({
      data: { tenantId: empresa.id, actionPlanId: sheet.planId, title: 'descartavel', externalKey: 'A-9999' },
    });
    const negados = await Promise.all(
      [Role.OPERACIONAL, Role.LEITOR].map((role) =>
        request(app)
          .delete(`${API}/action-plan-sheets/${sheet.planId}/rows/${alvo.id}`)
          .set(auth(role)),
      ),
    );
    expect(negados.every((r) => !permitido(r.status))).toBe(true);

    const aceito = await request(app)
      .delete(`${API}/action-plan-sheets/${sheet.planId}/rows/${alvo.id}`)
      .set(auth(Role.GESTOR));
    expect(permitido(aceito.status)).toBe(true);
  });
});

describe('operacional só enxerga as próprias ações', () => {
  it('não conta as linhas de que não é responsável', async () => {
    const res = await request(app)
      .get(`${API}/action-plan-sheets/${sheet.planId}`)
      .set(auth(Role.OPERACIONAL));
    expect(res.body.data.rowCount).toBe(0);
  });

  it('passa a contar depois de virar responsável', async () => {
    await request(app)
      .patch(`${API}/action-plan-sheets/${sheet.planId}/rows/${sheet.rowId}`)
      .set(auth(Role.GERENTE))
      .send({ responsibleId: empresa.users.OPERACIONAL.id });
    const res = await request(app)
      .get(`${API}/action-plan-sheets/${sheet.planId}`)
      .set(auth(Role.OPERACIONAL));
    expect(res.body.data.rowCount).toBe(1);
  });

  it('não resolve ação de outra pessoa', async () => {
    const alheia = await prisma.actionPlanRow.create({
      data: { tenantId: empresa.id, actionPlanId: sheet.planId, title: 'de outro', externalKey: 'A-8888' },
    });
    const res = await request(app)
      .post(`${API}/action-plan-sheets/${sheet.planId}/rows/${alheia.id}/resolve`)
      .set(auth(Role.OPERACIONAL))
      .send({});
    expect(permitido(res.status)).toBe(false);
  });
});
