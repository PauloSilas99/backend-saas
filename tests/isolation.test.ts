import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '@/app';
import {
  disconnect,
  dropTenant,
  seedSheetWithRow,
  seedTenant,
  type SeededTenant,
} from './helpers/fixture';

const API = '/api/v1';

let alpha: SeededTenant;
let beta: SeededTenant;
let betaSheet: { planId: string; rowId: string; columnId: string };
let alphaToken: string;

beforeAll(async () => {
  alpha = await seedTenant('alpha');
  beta = await seedTenant('beta');
  betaSheet = await seedSheetWithRow(beta, beta.users.GERENTE.id);
  alphaToken = alpha.users.GERENTE.token;
}, 60_000);

afterAll(async () => {
  await dropTenant(alpha.id);
  await dropTenant(beta.id);
  await disconnect();
});

describe('isolamento entre empresas', () => {
  it('o gerente de uma empresa não enxerga a planilha da outra', async () => {
    const res = await request(app)
      .get(`${API}/action-plan-sheets/${betaSheet.planId}`)
      .set('Authorization', `Bearer ${alphaToken}`);
    expect(res.status).not.toBe(200);
  });

  const rotasDeLeitura = () => [
    `${API}/action-plan-sheets/${betaSheet.planId}`,
    `${API}/action-plan-sheets/${betaSheet.planId}/rows`,
    `${API}/action-plan-sheets/${betaSheet.planId}/analytics`,
    `${API}/action-plan-sheets/${betaSheet.planId}/export`,
    `${API}/action-plan-sheets/${betaSheet.planId}/my-charts`,
    `${API}/action-plan-sheets/${betaSheet.planId}/rows/${betaSheet.rowId}/evidence`,
  ];

  it('nenhuma rota de leitura devolve 200 para id de outra empresa', async () => {
    const vazamentos: string[] = [];
    for (const url of rotasDeLeitura()) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${alphaToken}`);
      if (res.status === 200) vazamentos.push(`${url} -> 200`);
    }
    expect(vazamentos).toEqual([]);
  });

  it('nenhuma rota de escrita altera dado de outra empresa', async () => {
    const auth = { Authorization: `Bearer ${alphaToken}` };
    const sheet = `${API}/action-plan-sheets/${betaSheet.planId}`;

    const respostas = await Promise.all([
      request(app).post(`${sheet}/rows`).set(auth).send({ title: 'invasao' }),
      request(app).patch(`${sheet}/rows/${betaSheet.rowId}`).set(auth).send({ title: 'sequestrada' }),
      request(app).post(`${sheet}/rows/${betaSheet.rowId}/resolve`).set(auth).send({}),
      request(app).post(`${sheet}/rows/${betaSheet.rowId}/duplicate`).set(auth).send({}),
      request(app)
        .post(`${sheet}/columns`)
        .set(auth)
        .send({ name: 'c_invasora', label: 'Invasora', fieldType: 'TEXT' }),
      request(app)
        .post(`${sheet}/rows/${betaSheet.rowId}/evidence/value`)
        .set(auth)
        .send({ kind: 'TEXTO', value: 'evidencia plantada' }),
      request(app).put(`${sheet}/my-charts`).set(auth).send({ charts: [] }),
    ]);

    expect(respostas.filter((r) => r.status >= 200 && r.status < 300)).toEqual([]);
  });

  it('a planilha invadida continua com uma coluna e uma linha', async () => {
    const dono = { Authorization: `Bearer ${beta.users.GERENTE.token}` };
    const resumo = await request(app)
      .get(`${API}/action-plan-sheets/${betaSheet.planId}`)
      .set(dono);
    expect(resumo.body.data.columns).toHaveLength(1);
    expect(resumo.body.data.rowCount).toBe(1);
  });

  it('excluir linha de outra empresa não a remove', async () => {
    await request(app)
      .delete(`${API}/action-plan-sheets/${betaSheet.planId}/rows/${betaSheet.rowId}`)
      .set('Authorization', `Bearer ${alphaToken}`);

    const dono = await request(app)
      .get(`${API}/action-plan-sheets/${betaSheet.planId}/rows`)
      .set('Authorization', `Bearer ${beta.users.GERENTE.token}`);
    expect(dono.status).toBe(200);
    expect(dono.body.data.items).toHaveLength(1);
  });

  describe('controle — as mesmas rotas funcionam para o dono', () => {
    it('leitura devolve 200 para quem é da empresa', async () => {
      const dono = { Authorization: `Bearer ${beta.users.GERENTE.token}` };
      const negados: string[] = [];
      for (const url of rotasDeLeitura()) {
        const res = await request(app).get(url).set(dono);
        if (res.status !== 200) negados.push(`${url} -> ${res.status}`);
      }
      expect(negados).toEqual([]);
    });

    it('escrita é aceita para quem é da empresa', async () => {
      const dono = { Authorization: `Bearer ${beta.users.GERENTE.token}` };
      const res = await request(app)
        .post(`${API}/action-plan-sheets/${betaSheet.planId}/rows`)
        .set(dono)
        .send({ title: 'linha legitima' });
      expect(res.status).toBe(201);
    });
  });
});
