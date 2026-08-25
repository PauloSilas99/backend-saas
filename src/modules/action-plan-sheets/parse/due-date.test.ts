import { describe, expect, it } from 'vitest';
import {
  classifyCalendarDateColumn,
  parseDueDateString,
  pickDueDateFromNamedValues,
} from './due-date';

describe('due-date', () => {
  it('recusa serial Excel curto e texto inválido', () => {
    expect(parseDueDateString('78')).toBeUndefined();
    expect(parseDueDateString('#REF!')).toBeUndefined();
    expect(parseDueDateString('')).toBeUndefined();
  });

  it('aceita ISO e data BR', () => {
    expect(parseDueDateString('2026-06-06')?.toISOString().slice(0, 10)).toBe('2026-06-06');
    expect(parseDueDateString('07/04/2026')?.toISOString().slice(0, 10)).toBe('2026-04-07');
  });

  it('escolhe prazo válido e ignora 78 da coluna prazo', () => {
    const due = pickDueDateFromNamedValues({
      prazo_acoes_de_melhoria_ou_implementacao: '78',
      data_conclusao: '',
      data_prox_verificacao: '2026-07-01',
      data_criacao: '2026-06-06',
    });
    expect(due?.toISOString().slice(0, 10)).toBe('2026-07-01');
  });

  it('classifica colunas da planilha PGR', () => {
    expect(classifyCalendarDateColumn('DATA CRIAÇÃO')).toBe('ocorrencia');
    expect(classifyCalendarDateColumn('data_verificacao')).toBe('inicio');
    expect(classifyCalendarDateColumn('prazo_acoes_de_melhoria_ou_implementacao')).toBe('prazo');
    expect(classifyCalendarDateColumn('DATA CONCLUSÃO')).toBe('prazo');
  });
});
