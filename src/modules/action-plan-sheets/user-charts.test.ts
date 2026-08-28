import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARTS,
  chartsForSheet,
  chartsForSheetWithDefaults,
  mergeSheetCharts,
  removeSheetCharts,
  sanitizeUserChartSpec,
} from './user-charts';

const SHEET = 'sheet-1';

describe('DEFAULT_CHARTS', () => {
  it('entrega os três gráficos que o briefing pede', () => {
    expect(DEFAULT_CHARTS).toHaveLength(3);
  });

  it('agrupa por chaves do catálogo, não por nome de coluna', () => {
    expect(DEFAULT_CHARTS.map((c) => c.columnKey)).toEqual([
      'status_atual',
      'prazo',
      'responsavel_solucao',
    ]);
  });

  it('marca a origem para a interface distinguir do que o usuário criou', () => {
    expect(DEFAULT_CHARTS.every((c) => c.origin === 'default')).toBe(true);
  });

  it('agrupa o gráfico de prazo por mês', () => {
    const prazo = DEFAULT_CHARTS.find((c) => c.columnKey === 'prazo');
    expect(prazo?.bucket).toBe('month');
  });

  it('não repete id', () => {
    expect(new Set(DEFAULT_CHARTS.map((c) => c.id)).size).toBe(DEFAULT_CHARTS.length);
  });
});

describe('chartsForSheetWithDefaults', () => {
  it('entrega os padrão para quem nunca mexeu', () => {
    expect(chartsForSheetWithDefaults(null, SHEET)).toEqual(DEFAULT_CHARTS);
  });

  it('entrega os padrão quando a planilha não está no mapa', () => {
    const raw = mergeSheetCharts(null, 'outra-planilha', []);
    expect(chartsForSheetWithDefaults(raw, SHEET)).toEqual(DEFAULT_CHARTS);
  });

  it('respeita lista vazia salva de propósito, sem ressuscitar os padrão', () => {
    const raw = mergeSheetCharts(null, SHEET, []);
    expect(chartsForSheetWithDefaults(raw, SHEET)).toEqual([]);
  });

  it('entrega a lista do usuário quando existe', () => {
    const meu = [
      {
        id: 'meu-1',
        title: 'Por unidade',
        type: 'bar' as const,
        columnKey: 'unidade',
        aggregation: 'count' as const,
      },
    ];
    const raw = mergeSheetCharts(null, SHEET, meu);
    expect(chartsForSheetWithDefaults(raw, SHEET).map((c) => c.id)).toEqual(['meu-1']);
  });
});

describe('sanitizeUserChartSpec', () => {
  it('preserva a origem', () => {
    const spec = sanitizeUserChartSpec({
      id: 'x',
      title: 'T',
      type: 'pie',
      columnKey: 'status_atual',
      aggregation: 'count',
      origin: 'default',
    });
    expect(spec?.origin).toBe('default');
  });

  it('trata origem desconhecida como do usuário', () => {
    const spec = sanitizeUserChartSpec({
      id: 'x',
      title: 'T',
      type: 'pie',
      columnKey: 'status_atual',
      aggregation: 'count',
      origin: 'seja-la-o-que-for',
    });
    expect(spec?.origin).toBe('user');
  });

  it('preserva o agrupamento mensal', () => {
    const spec = sanitizeUserChartSpec({
      id: 'x',
      title: 'T',
      type: 'bar',
      columnKey: 'prazo',
      aggregation: 'count',
      bucket: 'month',
    });
    expect(spec?.bucket).toBe('month');
  });

  it('descarta agrupamento inválido', () => {
    const spec = sanitizeUserChartSpec({
      id: 'x',
      title: 'T',
      type: 'bar',
      columnKey: 'prazo',
      aggregation: 'count',
      bucket: 'decada',
    });
    expect(spec?.bucket).toBeUndefined();
  });
});

describe('chartsForSheet', () => {
  it('continua devolvendo só o que o usuário salvou', () => {
    expect(chartsForSheet(null, SHEET)).toEqual([]);
  });
});

describe('removeSheetCharts', () => {
  it('tira a planilha do mapa, fazendo os padrão voltarem', () => {
    const raw = mergeSheetCharts(null, SHEET, []);
    const cleared = removeSheetCharts(raw, SHEET);
    expect(chartsForSheetWithDefaults(cleared, SHEET)).toEqual(DEFAULT_CHARTS);
  });

  it('não mexe nas outras planilhas', () => {
    const raw = mergeSheetCharts(mergeSheetCharts(null, 'outra', []), SHEET, []);
    const cleared = removeSheetCharts(raw, SHEET);
    expect(chartsForSheetWithDefaults(cleared, 'outra')).toEqual([]);
  });
});
