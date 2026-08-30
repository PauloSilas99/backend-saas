import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildPeriodFilterSql,
  parsePeriodParam,
  periodFilterCacheTag,
  PERIOD_DATE_COLUMN_KEYS,
} from './period-filter';

describe('parsePeriodParam', () => {
  it('devolve nulo quando o parâmetro não veio', () => {
    expect(parsePeriodParam(undefined)).toBeNull();
    expect(parsePeriodParam('')).toBeNull();
  });

  it('devolve nulo quando o JSON é inválido', () => {
    expect(parsePeriodParam('{años}')).toBeNull();
  });

  it('lê anos e mês', () => {
    expect(parsePeriodParam('{"years":["2026","2025"],"month":"09"}')).toEqual({
      years: ['2026', '2025'],
      month: '09',
    });
  });

  it('descarta ano que não é um ano de quatro dígitos', () => {
    expect(parsePeriodParam('{"years":["2026","abc","26",""],"month":"all"}')).toEqual({
      years: ['2026'],
      month: 'all',
    });
  });

  it('trata mês fora de 01–12 como todos os meses', () => {
    expect(parsePeriodParam('{"years":["2026"],"month":"13"}')?.month).toBe('all');
    expect(parsePeriodParam('{"years":["2026"],"month":""}')?.month).toBe('all');
  });

  it('devolve nulo quando nada restringe o período', () => {
    expect(parsePeriodParam('{"years":[],"month":"all"}')).toBeNull();
    expect(parsePeriodParam('{"years":["nada"],"month":"zz"}')).toBeNull();
  });
});

describe('buildPeriodFilterSql', () => {
  it('não filtra nada quando o período está vazio', () => {
    expect(buildPeriodFilterSql([], null)).toBe(Prisma.empty);
  });

  it('não filtra nada quando o plano não tem coluna de data', () => {
    expect(buildPeriodFilterSql([], { years: ['2026'], month: 'all' })).toBe(Prisma.empty);
  });

  it('monta o predicado quando há coluna e período', () => {
    const sql = buildPeriodFilterSql(['col-1'], { years: ['2026'], month: '09' });

    expect(sql).not.toBe(Prisma.empty);
    expect(sql.sql).toContain('AND');
  });
});

describe('periodFilterCacheTag', () => {
  it('é vazio sem período', () => {
    expect(periodFilterCacheTag(null)).toBe('');
  });

  it('muda quando o mês muda', () => {
    const setembro = periodFilterCacheTag({ years: ['2026'], month: '09' });
    const outubro = periodFilterCacheTag({ years: ['2026'], month: '10' });

    expect(setembro).not.toBe(outubro);
  });

  it('não depende da ordem dos anos', () => {
    expect(periodFilterCacheTag({ years: ['2025', '2026'], month: 'all' })).toBe(
      periodFilterCacheTag({ years: ['2026', '2025'], month: 'all' }),
    );
  });
});

describe('colunas de período', () => {
  it('cobre as sete colunas de data que o painel considera', () => {
    expect([...PERIOD_DATE_COLUMN_KEYS]).toEqual([
      'data_ocorrencia',
      'data_fim',
      'data_inicio',
      'data_criacao',
      'data_conclusao',
      'data_prox_verificacao',
      'data_verificacao',
    ]);
  });
});
