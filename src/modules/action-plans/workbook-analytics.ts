import { Prisma } from '@prisma/client';

export type SheetAnalyticsKpis = {
  total: number;
  concluidas: number;
  atrasadas: number;
  aVencer7d: number;
  noPrazo: number;
  cancelados: number;
  aderenciaPct: number;
  conclusaoPct: number;
};

export type SheetAnalyticsSlice = { label: string; value: number };

export type SheetAnalyticsResult = {
  totalAcoes: number;
  rowCount: number;
  byStatus: SheetAnalyticsSlice[];
  byPrioridade: Array<SheetAnalyticsSlice & { percent: number }>;
  byIndicador: SheetAnalyticsSlice[];
  byUnidadeTop10: SheetAnalyticsSlice[];
  byResponsavelTop10: SheetAnalyticsSlice[];
  kpis: SheetAnalyticsKpis;
  filterOptions: {
    years: string[];
    responsaveis: string[];
    unidades: string[];
    locais: string[];
    gestores: string[];
    customColumns: Array<{ key: string; label: string; values: string[] }>;
  };
};

type KpiRow = {
  total: number;
  concluidas: number;
  on_time_completed: number;
  atrasadas: number;
  a_vencer_7d: number;
  no_prazo: number;
  cancelados: number;
};

type GroupRow = {
  bucket: string;
  label: string;
  cnt: number;
};

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function slicesFrom(
  rows: GroupRow[],
  bucket: string,
  limit?: number,
): SheetAnalyticsSlice[] {
  const items = rows
    .filter((row) => row.bucket === bucket)
    .map((row) => ({ label: row.label, value: toInt(row.cnt) }))
    .sort((a, b) => b.value - a.value);
  return limit ? items.slice(0, limit) : items;
}

export function mapWorkbookAnalytics(
  kpi: KpiRow | undefined,
  groups: GroupRow[],
): SheetAnalyticsResult {
  const total = toInt(kpi?.total);
  const concluidas = toInt(kpi?.concluidas);
  const onTime = toInt(kpi?.on_time_completed);
  const atrasadas = toInt(kpi?.atrasadas);
  const aVencer7d = toInt(kpi?.a_vencer_7d);
  const noPrazo = toInt(kpi?.no_prazo);
  const cancelados = toInt(kpi?.cancelados);
  const byPrioridade = slicesFrom(groups, 'prioridade');
  const byUnidade = slicesFrom(groups, 'unidade', 10);
  const byResponsavel = slicesFrom(groups, 'responsavel', 10);

  return {
    totalAcoes: total,
    rowCount: total,
    byStatus: slicesFrom(groups, 'status'),
    byPrioridade: byPrioridade.map((s) => ({
      ...s,
      percent: total > 0 ? Math.round((s.value / total) * 100) : 0,
    })),
    byIndicador: slicesFrom(groups, 'indicador'),
    byUnidadeTop10: byUnidade,
    byResponsavelTop10: byResponsavel,
    kpis: {
      total,
      concluidas,
      atrasadas,
      aVencer7d,
      noPrazo,
      cancelados,
      aderenciaPct: concluidas > 0 ? Math.round((onTime / concluidas) * 100) : 0,
      conclusaoPct: total > 0 ? Math.round((concluidas / total) * 100) : 0,
    },
    filterOptions: {
      years: [],
      responsaveis: byResponsavel.map((s) => s.label),
      unidades: byUnidade.map((s) => s.label),
      locais: [],
      gestores: [],
      customColumns: [],
    },
  };
}

export const EMPTY_SHEET_ANALYTICS = mapWorkbookAnalytics(undefined, []);
