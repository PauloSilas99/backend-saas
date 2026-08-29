import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ActionStatus, Role } from '@prisma/client';
import { app } from '@/app';
import { CANONICAL_COLUMNS } from '@modules/columns/canonical-catalog';
import { disconnect, dropTenant, prisma, seedTenant, type SeededTenant } from './helpers/fixture';

const API = '/api/v1';
const COLUNAS = ['acoes', 'prazo', 'data_conclusao', 'status_atual', 'status_final'];

let empresa: SeededTenant;
let planId: string;
let colunaPorChave: Record<string, string> = {};

function auth(role: Role = Role.GERENTE) {
  return { Authorization: `Bearer ${empresa.users[role].token}` };
}

async function estadoDasLinhas() {
  const rows = await prisma.actionPlanRow.findMany({
    where: { actionPlanId: planId, deletedAt: null },
    select: { externalKey: true, title: true, status: true, cells: true },
    orderBy: { externalKey: 'asc' },
  });
  return rows;
}

beforeAll(async () => {
  empresa = await seedTenant('ciclo');
  const plan = await prisma.actionPlan.create({
    data: { tenantId: empresa.id, ownerId: empresa.users.GERENTE.id, title: 'Ciclo' },
  });
  planId = plan.id;

  for (const [index, key] of COLUNAS.entries()) {
    const canonical = CANONICAL_COLUMNS.find((c) => c.key === key)!;
    const created = await prisma.actionColumn.create({
      data: {
        tenantId: empresa.id,
        actionPlanId: planId,
        name: `c_${key}`,
        label: canonical.label,
        canonicalKey: key,
        fieldType: 'TEXT',
        sortOrder: index,
      },
    });
    colunaPorChave[key] = created.id;
  }
}, 60_000);

afterAll(async () => {
  await dropTenant(empresa.id);
  await disconnect();
});

async function importar(linhas: Array<Record<string, unknown>>) {
  return request(app)
    .post(`${API}/action-plan-sheets/import`)
    .set(auth())
    .send({
      title: 'Ciclo',
      columns: [],
      rows: linhas,
      options: { planId, skipColumnSync: true, upsertByExternalKey: true },
    });
}

describe('ciclo completo: importa, resolve, exporta, reimporta', () => {
  it('importa duas linhas e projeta o status a partir do prazo', async () => {
    const res = await importar([
      {
        title: 'Trocar guarda-corpo',
        externalKey: 'C-001',
        values: {
          [colunaPorChave.acoes]: 'Trocar guarda-corpo',
          [colunaPorChave.prazo]: '2020-01-01',
        },
      },
      {
        title: 'Revisar EPI',
        externalKey: 'C-002',
        values: {
          [colunaPorChave.acoes]: 'Revisar EPI',
          [colunaPorChave.prazo]: '2030-12-31',
        },
      },
    ]);
    expect(res.status).toBe(201);

    const linhas = await estadoDasLinhas();
    expect(linhas.map((l) => l.externalKey)).toEqual(['C-001', 'C-002']);
    expect((linhas[0].cells as Record<string, string>)[colunaPorChave.status_atual]).toBe(
      'em atraso',
    );
    expect((linhas[1].cells as Record<string, string>)[colunaPorChave.status_atual]).toBe(
      'no prazo',
    );
  });

  it('resolver grava data, status e status final nas células', async () => {
    const alvo = await prisma.actionPlanRow.findFirst({
      where: { actionPlanId: planId, externalKey: 'C-001' },
    });
    await request(app)
      .post(`${API}/action-plan-sheets/${planId}/rows/${alvo!.id}/resolve`)
      .set(auth())
      .send({ completedAt: '2020-02-01T12:00:00.000Z' });

    const linha = await prisma.actionPlanRow.findFirst({
      where: { actionPlanId: planId, externalKey: 'C-001' },
    });
    const cells = linha!.cells as Record<string, string>;
    expect(cells[colunaPorChave.data_conclusao]).toBe('2020-02-01');
    expect(cells[colunaPorChave.status_atual]).toBe('concluído');
    expect(cells[colunaPorChave.status_final]).toBe('concluída em atraso');
    expect(linha!.status).toBe(ActionStatus.COMPLETED);
  });

  it('a exportação traz os IDs e os valores derivados', async () => {
    const res = await request(app)
      .get(`${API}/action-plan-sheets/${planId}/export`)
      .set(auth())
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const ids = [sheet.getCell('A2').value, sheet.getCell('A3').value];
    expect(ids).toEqual(['C-001', 'C-002']);
    expect(sheet.getCell('AP2').value).toBe('concluído');
    expect(sheet.getCell('AQ2').value).toBe('concluída em atraso');
  });

  it('reimportar o mesmo conteúdo não duplica nem altera', async () => {
    const antes = await estadoDasLinhas();

    await importar(
      antes.map((linha) => ({
        title: linha.title,
        externalKey: linha.externalKey,
        values: linha.cells as Record<string, string>,
      })),
    );

    const depois = await estadoDasLinhas();
    expect(depois).toHaveLength(antes.length);
    expect(depois.map((l) => l.externalKey)).toEqual(antes.map((l) => l.externalKey));
    expect(depois.map((l) => l.status)).toEqual(antes.map((l) => l.status));
  });
});

describe('regressões da projeção', () => {
  it('não rebaixa ação que aguarda aprovação', async () => {
    const linha = await prisma.actionPlanRow.create({
      data: {
        tenantId: empresa.id,
        actionPlanId: planId,
        externalKey: 'C-100',
        title: 'Aguardando',
        status: ActionStatus.WAITING_APPROVAL,
        cells: {
          [colunaPorChave.acoes]: 'Aguardando',
          [colunaPorChave.prazo]: '2030-12-31',
        },
      },
    });

    await request(app)
      .patch(`${API}/action-plan-sheets/${planId}/rows/${linha.id}`)
      .set(auth())
      .send({ values: { [colunaPorChave.acoes]: 'Aguardando aprovacao' } });

    const depois = await prisma.actionPlanRow.findUnique({ where: { id: linha.id } });
    expect(depois!.status).toBe(ActionStatus.WAITING_APPROVAL);
  });

  it('preserva o valor de coluna dinâmica que a projeção não conhece', async () => {
    const dinamica = await prisma.actionColumn.create({
      data: {
        tenantId: empresa.id,
        actionPlanId: planId,
        name: 'c_centro_custo',
        label: 'CENTRO DE CUSTO',
        fieldType: 'TEXT',
        sortOrder: 90,
      },
    });
    const linha = await prisma.actionPlanRow.create({
      data: {
        tenantId: empresa.id,
        actionPlanId: planId,
        externalKey: 'C-200',
        title: 'Com coluna extra',
        cells: { [dinamica.id]: 'CC-4711', [colunaPorChave.acoes]: 'Com coluna extra' },
      },
    });

    await request(app)
      .patch(`${API}/action-plan-sheets/${planId}/rows/${linha.id}`)
      .set(auth())
      .send({ values: { [colunaPorChave.prazo]: '2031-01-01' } });

    const depois = await prisma.actionPlanRow.findUnique({ where: { id: linha.id } });
    expect((depois!.cells as Record<string, string>)[dinamica.id]).toBe('CC-4711');
  });
});
