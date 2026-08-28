import { describe, expect, it } from 'vitest';
import { CANONICAL_COLUMNS } from '@modules/columns/canonical-catalog';
import { buildHeaderReport, missingRowKeys, validateRowValues } from './import-report';

describe('buildHeaderReport', () => {
  it('casa todos os cabeçalhos do modelo, sem sobra nem falta', () => {
    const report = buildHeaderReport(CANONICAL_COLUMNS.map((c) => c.label));
    expect(report.matched).toHaveLength(56);
    expect(report.unmatched).toEqual([]);
    expect(report.missing).toEqual([]);
  });

  it('devolve a letra da coluna junto da chave', () => {
    const report = buildHeaderReport(['AÇÕES']);
    expect(report.matched[0]).toEqual({ header: 'AÇÕES', canonicalKey: 'acoes', column: 'AF' });
  });

  it('lista cabeçalho fora do catálogo como não casado, com o índice', () => {
    const report = buildHeaderReport(['AÇÕES', 'CENTRO DE CUSTO']);
    expect(report.unmatched).toEqual([{ header: 'CENTRO DE CUSTO', colIndex: 1 }]);
  });

  it('lista as colunas canônicas que a planilha não trouxe', () => {
    const report = buildHeaderReport(['AÇÕES']);
    expect(report.missing).toHaveLength(55);
    expect(report.missing.some((m) => m.canonicalKey === 'prazo')).toBe(true);
  });

  it('em disputa pela mesma chave, o primeiro casa e o segundo vira não casado', () => {
    const report = buildHeaderReport(['STATUS ATUAL', 'situação']);
    expect(report.matched.map((m) => m.header)).toEqual(['STATUS ATUAL']);
    expect(report.unmatched.map((u) => u.header)).toEqual(['situação']);
  });

  it('ignora cabeçalho vazio', () => {
    const report = buildHeaderReport(['AÇÕES', '', '   ']);
    expect(report.unmatched).toEqual([]);
  });
});

describe('missingRowKeys', () => {
  it('aponta a linha que existe na base e sumiu do arquivo', () => {
    expect(missingRowKeys(['A-0001', 'A-0002'], ['A-0001'])).toEqual(['A-0002']);
  });

  it('não reclama quando o arquivo traz tudo', () => {
    expect(missingRowKeys(['A-0001'], ['A-0001'])).toEqual([]);
  });

  it('ignora linha da base que nunca teve chave', () => {
    expect(missingRowKeys([null, 'A-0001'], ['A-0001'])).toEqual([]);
  });

  it('não considera ausente a linha nova, que só existe no arquivo', () => {
    expect(missingRowKeys(['A-0001'], ['A-0001', 'A-0002'])).toEqual([]);
  });
});

describe('validateRowValues', () => {
  const ok = { acoes: 'Trocar EPI', prazo: '2026-09-30' };

  it('não reclama de linha completa', () => {
    expect(validateRowValues(ok)).toEqual([]);
  });

  it('recusa a linha sem AÇÕES — não há o que importar', () => {
    const issues = validateRowValues({ ...ok, acoes: '   ' });
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'TITLE_REQUIRED' }),
    );
  });

  it('recusa data ilegível em coluna de data', () => {
    const issues = validateRowValues({ ...ok, prazo: 'semana que vem' });
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: 'ERROR', code: 'INVALID_DATE' }),
    );
  });

  it('avisa quando o prazo não foi preenchido', () => {
    const issues = validateRowValues({ acoes: 'Trocar EPI' });
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: 'WARNING', code: 'MISSING_DUE_DATE' }),
    );
  });

  it('avisa sobre valor fora da lista fechada, sem barrar a linha', () => {
    const issues = validateRowValues({ ...ok, prioridade: 'urgentíssima' });
    const issue = issues.find((i) => i.code === 'VALUE_OUT_OF_VOCABULARY');
    expect(issue?.severity).toBe('WARNING');
    expect(issue?.message).toContain('urgentíssima');
  });

  it('aceita valor da lista com caixa e acento diferentes', () => {
    expect(validateRowValues({ ...ok, prioridade: 'ALTA' })).toEqual([]);
  });

  it('não reclama de coluna de lista deixada em branco', () => {
    expect(validateRowValues({ ...ok, prioridade: '' })).toEqual([]);
  });

  it('não valida vocabulário de coluna gerida pelo sistema', () => {
    expect(validateRowValues({ ...ok, status_atual: 'qualquer coisa' })).toEqual([]);
  });
});
