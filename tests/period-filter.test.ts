import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '@/app';
import { disconnect, dropTenant, prisma, seedTenant, type SeededTenant } from './helpers/fixture';

const API = '/api/v1';

let tenant: SeededTenant;
let token: string;
let planId: string;

const AMOSTRA: Array<{ chave: string; celula: string; esperado: string | null }> = [
  { chave: 'iso', celula: '2026-09-15', esperado: '2026-09-15' },
  { chave: 'iso-hora', celula: '2026-09-15T10:00:00', esperado: '2026-09-15' },
  { chave: 'br-barra', celula: '15/09/2026', esperado: '2026-09-15' },
  { chave: 'br-traco', celula: '15-09-2026', esperado: '2026-09-15' },
  { chave: 'br-ponto', celula: '15.09.2026', esperado: '2026-09-15' },
  { chave: 'br-curto', celula: '5/9/26', esperado: '2026-09-05' },
  { chave: 'br-sufixo', celula: '15/09/2026 10:00', esperado: '2026-09-15' },
  { chave: 'serial', celula: '45678', esperado: '2025-01-21' },
  { chave: 'serial-virgula', celula: '45678,0', esperado: '2025-01-21' },
  { chave: 'outro-mes', celula: '2026-10-01', esperado: '2026-10-01' },
  { chave: 'outro-ano', celula: '2025-09-30', esperado: '2025-09-30' },
  { chave: 'dia-inexistente', celula: '31/02/2026', esperado: null },
  { chave: 'mes-inexistente', celula: '2026-02-31', esperado: null },
  { chave: 'recorrencia', celula: 'MENSAL', esperado: null },
  { chave: 'texto', celula: 'texto qualquer', esperado: null },
  { chave: 'vazia', celula: '', esperado: null },
];

const SEM_DATA = AMOSTRA.filter((a) => a.esperado === null).map((a) => a.chave);

function periodo(years: string[], month: string): string {
  return JSON.stringify({ years, month });
}

async function chavesFiltradas(period?: string): Promise<string[]> {
  const res = await request(app)
    .get(`${API}/action-plan-sheets/${planId}/rows`)
    .query({ page: 1, pageSize: 100, ...(period ? { period } : {}) })
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data.items.map((item: { externalKey: string }) => item.externalKey).sort();
}

beforeAll(async () => {
  tenant = await seedTenant('periodfilter');
  token = tenant.users.GERENTE.token;

  const plan = await prisma.actionPlan.create({
    data: { tenantId: tenant.id, ownerId: tenant.users.GERENTE.id, title: 'Plano período' },
  });
  planId = plan.id;

  const coluna = await prisma.actionColumn.create({
    data: {
      tenantId: tenant.id,
      actionPlanId: plan.id,
      name: 'data_ocorrencia',
      label: 'DATA DA OCORRÊNCIA',
      canonicalKey: 'data_ocorrencia',
      fieldType: 'DATE',
      sortOrder: 0,
    },
  });

  for (const amostra of AMOSTRA) {
    await prisma.actionPlanRow.create({
      data: {
        tenantId: tenant.id,
        actionPlanId: plan.id,
        externalKey: amostra.chave,
        title: `Ação ${amostra.chave}`,
        cells: { [coluna.id]: amostra.celula },
      },
    });
  }
}, 60_000);

afterAll(async () => {
  await dropTenant(tenant.id);
  await disconnect();
});

describe('filtro de período no servidor', () => {
  it('sem período devolve a amostra inteira', async () => {
    expect(await chavesFiltradas()).toHaveLength(AMOSTRA.length);
  });

  it('reconhece ISO, formato brasileiro e serial do Excel no mesmo ano', async () => {
    const chaves = await chavesFiltradas(periodo(['2026'], 'all'));

    expect(chaves).toEqual(
      [
        'br-barra',
        'br-curto',
        'br-ponto',
        'br-sufixo',
        'br-traco',
        'iso',
        'iso-hora',
        'outro-mes',
        ...SEM_DATA,
      ].sort(),
    );
  });

  it('separa o mês dentro do ano', async () => {
    const chaves = await chavesFiltradas(periodo(['2026'], '09'));

    expect(chaves).toEqual(
      ['br-barra', 'br-curto', 'br-ponto', 'br-sufixo', 'br-traco', 'iso', 'iso-hora', ...SEM_DATA].sort(),
    );
  });

  it('trata o serial do Excel como janeiro de 2025, como o Excel faz', async () => {
    const chaves = await chavesFiltradas(periodo(['2025'], '01'));

    expect(chaves).toEqual(['serial', 'serial-virgula', ...SEM_DATA].sort());
  });

  it('soma os anos escolhidos', async () => {
    const doisAnos = await chavesFiltradas(periodo(['2025', '2026'], 'all'));
    const so2026 = await chavesFiltradas(periodo(['2026'], 'all'));

    expect(doisAnos.length).toBeGreaterThan(so2026.length);
    expect(doisAnos).toContain('outro-ano');
  });

  it('filtra por mês em qualquer ano quando nenhum ano foi escolhido', async () => {
    const chaves = await chavesFiltradas(periodo([], '10'));

    expect(chaves).toEqual(['outro-mes', ...SEM_DATA].sort());
  });

  it('mantém a linha sem data legível em qualquer período, como o painel faz', async () => {
    const chaves = await chavesFiltradas(periodo(['2030'], '07'));

    expect(chaves).toEqual([...SEM_DATA].sort());
  });

  it('descarta o dia que não existe no calendário em vez de arredondá-lo', async () => {
    const fevereiro = await chavesFiltradas(periodo(['2026'], '02'));
    const mesSemNada = await chavesFiltradas(periodo(['2030'], '07'));

    // Data ilegível não vira fevereiro: a linha entra como "sem data", em todo período.
    expect(fevereiro).toContain('dia-inexistente');
    expect(mesSemNada).toContain('dia-inexistente');
    expect(fevereiro).toEqual(mesSemNada);
  });
});
