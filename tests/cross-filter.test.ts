import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '@/app';
import { disconnect, dropTenant, prisma, seedTenant, type SeededTenant } from './helpers/fixture';

const API = '/api/v1';

let tenant: SeededTenant;
let token: string;
let planId: string;

const AMOSTRA = [
  { prioridade: 'Urgente', unidade: 'Matriz' },
  { prioridade: 'Urgente', unidade: 'Filial' },
  { prioridade: 'Importante', unidade: 'Matriz' },
  { prioridade: 'Importante', unidade: 'Filial' },
  { prioridade: 'Importante', unidade: 'Filial' },
  { prioridade: '', unidade: 'Matriz' },
];

function filtro(columnKey: string, values: string[]): string {
  return JSON.stringify([{ columnKey, values }]);
}

async function listar(filters?: string) {
  return request(app)
    .get(`${API}/action-plan-sheets/${planId}/rows`)
    .query({ page: 1, pageSize: 100, ...(filters ? { filters } : {}) })
    .set('Authorization', `Bearer ${token}`);
}

async function analisar(filters?: string) {
  return request(app)
    .get(`${API}/action-plan-sheets/${planId}/analytics`)
    .query(filters ? { filters } : {})
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  tenant = await seedTenant('crossfilter');
  token = tenant.users.GERENTE.token;

  const plan = await prisma.actionPlan.create({
    data: {
      tenantId: tenant.id,
      ownerId: tenant.users.GERENTE.id,
      title: 'Plano cross-filter',
    },
  });
  planId = plan.id;

  const prioridade = await prisma.actionColumn.create({
    data: {
      tenantId: tenant.id,
      actionPlanId: plan.id,
      name: 'prioridade',
      label: 'PRIORIDADE',
      canonicalKey: 'prioridade',
      fieldType: 'TEXT',
      sortOrder: 0,
    },
  });
  const unidade = await prisma.actionColumn.create({
    data: {
      tenantId: tenant.id,
      actionPlanId: plan.id,
      name: 'unidade',
      label: 'UNIDADE',
      canonicalKey: 'unidade',
      fieldType: 'TEXT',
      sortOrder: 1,
    },
  });

  for (const [index, amostra] of AMOSTRA.entries()) {
    await prisma.actionPlanRow.create({
      data: {
        tenantId: tenant.id,
        actionPlanId: plan.id,
        externalKey: `CF-${index}`,
        title: `Ação ${index}`,
        cells: {
          [prioridade.id]: amostra.prioridade,
          [unidade.id]: amostra.unidade,
        },
      },
    });
  }
}, 60_000);

afterAll(async () => {
  await dropTenant(tenant.id);
  await disconnect();
});

describe('cross-filter nas linhas', () => {
  it('sem filtro devolve a amostra inteira', async () => {
    const res = await listar();

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(AMOSTRA.length);
  });

  it('filtra pelo valor de uma coluna', async () => {
    const res = await listar(filtro('prioridade', ['Urgente']));

    expect(res.body.data.pagination.total).toBe(2);
  });

  it('soma os valores escolhidos dentro da mesma coluna', async () => {
    const res = await listar(filtro('prioridade', ['Urgente', 'Importante']));

    expect(res.body.data.pagination.total).toBe(5);
  });

  it('cruza colunas diferentes em vez de somá-las', async () => {
    const res = await listar(
      JSON.stringify([
        { columnKey: 'prioridade', values: ['Importante'] },
        { columnKey: 'unidade', values: ['Filial'] },
      ]),
    );

    expect(res.body.data.pagination.total).toBe(2);
  });

  it('alcança as linhas vazias pela fatia "Não informado"', async () => {
    const res = await listar(filtro('prioridade', ['Não informado']));

    expect(res.body.data.pagination.total).toBe(1);
  });

  it('ignora filtro de coluna inexistente em vez de zerar a planilha', async () => {
    const res = await listar(filtro('coluna_fantasma', ['x']));

    expect(res.body.data.pagination.total).toBe(AMOSTRA.length);
  });
});

describe('cross-filter nos indicadores', () => {
  it('o total do KPI acompanha o filtro', async () => {
    const res = await analisar(filtro('prioridade', ['Urgente']));

    expect(res.status).toBe(200);
    expect(res.body.data.kpis.total).toBe(2);
  });

  it('o KPI conta o mesmo que a tabela sob o mesmo filtro', async () => {
    const combinado = JSON.stringify([
      { columnKey: 'prioridade', values: ['Importante'] },
      { columnKey: 'unidade', values: ['Filial'] },
    ]);

    const [linhas, indicadores] = await Promise.all([listar(combinado), analisar(combinado)]);

    expect(indicadores.body.data.kpis.total).toBe(linhas.body.data.pagination.total);
  });

  it('não serve resultado cacheado de um filtro para outro', async () => {
    const urgente = await analisar(filtro('prioridade', ['Urgente']));
    const importante = await analisar(filtro('prioridade', ['Importante']));

    expect(urgente.body.data.kpis.total).toBe(2);
    expect(importante.body.data.kpis.total).toBe(3);
  });

  it('a distribuição por unidade respeita o filtro de prioridade', async () => {
    const res = await analisar(filtro('prioridade', ['Importante']));

    const matriz = res.body.data.byUnidadeTop10.find(
      (slice: { label: string }) => slice.label === 'Matriz',
    );
    expect(matriz?.value).toBe(1);
  });
});
