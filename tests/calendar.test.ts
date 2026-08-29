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
const PRAZO_ORIGINAL = new Date('2026-10-15T00:00:00.000Z');
const REMANEJADO = '2026-11-20T00:00:00.000Z';

let empresa: SeededTenant;
let sheet: { planId: string; rowId: string; columnId: string };

function auth(role: Role) {
  return { Authorization: `Bearer ${empresa.users[role].token}` };
}

beforeAll(async () => {
  empresa = await seedTenant('calendario');
  sheet = await seedSheetWithRow(empresa, empresa.users.GERENTE.id);
  await prisma.actionPlanRow.update({
    where: { id: sheet.rowId },
    data: { dueDate: PRAZO_ORIGINAL, responsibleId: empresa.users.OPERACIONAL.id },
  });
}, 60_000);

afterAll(async () => {
  await dropTenant(empresa.id);
  await disconnect();
});

async function remanejar(role: Role, quando: string) {
  return request(app)
    .put(`${API}/calendar/actions/${sheet.rowId}/overlay`)
    .set(auth(role))
    .send({ displayStartsAt: quando });
}

describe('calendário é gestão pessoal, não espelho da planilha', () => {
  it('remanejar não altera o prazo da ação na base', async () => {
    const res = await remanejar(Role.GESTOR, REMANEJADO);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const row = await prisma.actionPlanRow.findUnique({ where: { id: sheet.rowId } });
    expect(row?.dueDate?.toISOString()).toBe(PRAZO_ORIGINAL.toISOString());
  });

  it('o remanejamento de um usuário não vaza para outro da mesma empresa', async () => {
    await remanejar(Role.GESTOR, REMANEJADO);

    const overlays = await prisma.calendarActionOverlay.findMany({
      where: { actionRowId: sheet.rowId },
    });
    expect(overlays).toHaveLength(1);
    expect(overlays[0].userId).toBe(empresa.users.GESTOR.id);
  });

  it('cada usuário tem o próprio remanejamento da mesma ação', async () => {
    await remanejar(Role.GESTOR, REMANEJADO);
    await remanejar(Role.OPERACIONAL, '2026-12-01T00:00:00.000Z');

    const overlays = await prisma.calendarActionOverlay.findMany({
      where: { actionRowId: sheet.rowId },
      orderBy: { createdAt: 'asc' },
    });
    expect(overlays).toHaveLength(2);
    expect(new Set(overlays.map((o) => o.userId)).size).toBe(2);
  });

  it('resolver a ação não apaga o remanejamento', async () => {
    await remanejar(Role.GESTOR, REMANEJADO);

    await request(app)
      .post(`${API}/action-plan-sheets/${sheet.planId}/rows/${sheet.rowId}/resolve`)
      .set(auth(Role.GESTOR))
      .send({ completedAt: '2026-10-10T12:00:00.000Z' });

    const overlays = await prisma.calendarActionOverlay.findMany({
      where: { actionRowId: sheet.rowId, userId: empresa.users.GESTOR.id },
    });
    expect(overlays).toHaveLength(1);
  });

  it('o prazo da base sobrevive à resolução', async () => {
    const row = await prisma.actionPlanRow.findUnique({ where: { id: sheet.rowId } });
    expect(row?.dueDate?.toISOString()).toBe(PRAZO_ORIGINAL.toISOString());
  });
});
