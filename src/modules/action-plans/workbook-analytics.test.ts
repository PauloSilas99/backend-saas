import { describe, expect, it } from 'vitest';
import { mapWorkbookAnalytics } from './workbook-analytics';

describe('mapWorkbookAnalytics', () => {
  it('aggregates KPI and grouping slices without transferring row payloads', () => {
    const result = mapWorkbookAnalytics(
      {
        total: 10,
        concluidas: 4,
        on_time_completed: 3,
        atrasadas: 2,
        a_vencer_7d: 1,
        no_prazo: 3,
        cancelados: 1,
      },
      [
        { bucket: 'status', label: 'PENDING', cnt: 6 },
        { bucket: 'status', label: 'COMPLETED', cnt: 4 },
        { bucket: 'prioridade', label: 'HIGH', cnt: 5 },
        { bucket: 'unidade', label: 'Matriz', cnt: 8 },
        { bucket: 'responsavel', label: 'Ana', cnt: 3 },
        { bucket: 'indicador', label: 'Quedas', cnt: 2 },
      ],
    );

    expect(result.kpis).toEqual({
      total: 10,
      concluidas: 4,
      atrasadas: 2,
      aVencer7d: 1,
      noPrazo: 3,
      cancelados: 1,
      aderenciaPct: 75,
      conclusaoPct: 40,
    });
    expect(result.byStatus[0]).toEqual({ label: 'PENDING', value: 6 });
    expect(result.byPrioridade[0].percent).toBe(50);
    expect(result.filterOptions.unidades).toEqual(['Matriz']);
  });

  it('returns zeros when the workbook is empty', () => {
    const empty = mapWorkbookAnalytics(undefined, []);
    expect(empty.kpis).toEqual({
      total: 0,
      concluidas: 0,
      atrasadas: 0,
      aVencer7d: 0,
      noPrazo: 0,
      cancelados: 0,
      aderenciaPct: 0,
      conclusaoPct: 0,
    });
    expect(empty.byStatus).toEqual([]);
  });
});
