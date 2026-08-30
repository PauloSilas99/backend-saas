import { describe, expect, it } from 'vitest';
import {
  buildCrossFilterSql,
  crossFilterCacheTag,
  parseCrossFilterParam,
  resolveCrossFilters,
  type CrossFilterColumn,
} from './cross-filter';

const COLUMNS: CrossFilterColumn[] = [
  { id: 'col-status', name: 'status_atual', canonicalKey: 'status_atual' },
  { id: 'col-prio', name: 'prioridade', canonicalKey: 'prioridade' },
  { id: 'col-avulsa', name: 'turno_da_equipe', canonicalKey: null },
];

describe('resolveCrossFilters', () => {
  it('encontra a coluna pela chave canônica', () => {
    const resolved = resolveCrossFilters(
      [{ columnKey: 'status_atual', values: ['em atraso'] }],
      COLUMNS,
    );

    expect(resolved).toEqual([{ columnId: 'col-status', values: ['em atraso'] }]);
  });

  it('encontra a coluna avulsa pelo nome quando não há chave canônica', () => {
    const resolved = resolveCrossFilters(
      [{ columnKey: 'turno_da_equipe', values: ['Noturno'] }],
      COLUMNS,
    );

    expect(resolved).toEqual([{ columnId: 'col-avulsa', values: ['Noturno'] }]);
  });

  it('aceita o id da coluna como chave', () => {
    const resolved = resolveCrossFilters([{ columnKey: 'col-prio', values: ['Urgente'] }], COLUMNS);

    expect(resolved).toEqual([{ columnId: 'col-prio', values: ['Urgente'] }]);
  });

  it('descarta filtro de coluna que não existe no plano', () => {
    const resolved = resolveCrossFilters(
      [{ columnKey: 'coluna_que_sumiu', values: ['x'] }],
      COLUMNS,
    );

    expect(resolved).toEqual([]);
  });

  it('descarta filtro sem nenhum valor em vez de zerar o resultado', () => {
    const resolved = resolveCrossFilters([{ columnKey: 'prioridade', values: [] }], COLUMNS);

    expect(resolved).toEqual([]);
  });

  it('ignora valores em branco', () => {
    const resolved = resolveCrossFilters(
      [{ columnKey: 'prioridade', values: ['Urgente', '   ', ''] }],
      COLUMNS,
    );

    expect(resolved).toEqual([{ columnId: 'col-prio', values: ['Urgente'] }]);
  });

  it('une os valores quando a mesma coluna aparece duas vezes', () => {
    const resolved = resolveCrossFilters(
      [
        { columnKey: 'prioridade', values: ['Urgente'] },
        { columnKey: 'col-prio', values: ['Importante'] },
      ],
      COLUMNS,
    );

    expect(resolved).toEqual([{ columnId: 'col-prio', values: ['Urgente', 'Importante'] }]);
  });

  it('não repete o mesmo valor duas vezes', () => {
    const resolved = resolveCrossFilters(
      [{ columnKey: 'prioridade', values: ['Urgente', 'Urgente'] }],
      COLUMNS,
    );

    expect(resolved).toEqual([{ columnId: 'col-prio', values: ['Urgente'] }]);
  });

  it('preserva o valor exatamente como veio, sem baixar caixa', () => {
    const resolved = resolveCrossFilters(
      [{ columnKey: 'status_atual', values: ['Em Atraso'] }],
      COLUMNS,
    );

    expect(resolved).toEqual([{ columnId: 'col-status', values: ['Em Atraso'] }]);
  });
});

describe('buildCrossFilterSql', () => {
  it('não gera predicado nenhum quando não há filtro', () => {
    const sql = buildCrossFilterSql([]);

    expect(sql.strings.join('').trim()).toBe('');
    expect(sql.values).toEqual([]);
  });

  it('manda o valor como parâmetro, nunca interpolado no texto do SQL', () => {
    const sql = buildCrossFilterSql([{ columnId: 'col-prio', values: ["Urgente'; DROP TABLE"] }]);

    expect(sql.strings.join('')).not.toContain('DROP TABLE');
    expect(sql.values).toContain("Urgente'; DROP TABLE");
  });

  it('trata o vazio da planilha como "Não informado" para a fatia clicável casar', () => {
    const sql = buildCrossFilterSql([{ columnId: 'col-prio', values: ['x'] }]);

    expect(sql.values).toContain('Não informado');
  });

  it('encadeia um predicado por coluna, cruzando as dimensões', () => {
    const sql = buildCrossFilterSql([
      { columnId: 'col-prio', values: ['Urgente'] },
      { columnId: 'col-status', values: ['em atraso'] },
    ]);

    expect(sql.strings.join('').match(/AND COALESCE/g)).toHaveLength(2);
    expect(sql.values).toEqual(
      expect.arrayContaining(['col-prio', 'Urgente', 'col-status', 'em atraso']),
    );
  });
});

describe('crossFilterCacheTag', () => {
  it('é vazio sem filtro, para não trocar a chave de cache de quem não filtra', () => {
    expect(crossFilterCacheTag([])).toBe('');
  });

  it('muda quando o valor filtrado muda', () => {
    const urgente = crossFilterCacheTag([{ columnId: 'c', values: ['Urgente'] }]);
    const importante = crossFilterCacheTag([{ columnId: 'c', values: ['Importante'] }]);

    expect(urgente).not.toBe(importante);
  });

  it('é o mesmo independentemente da ordem em que o usuário clicou', () => {
    const a = crossFilterCacheTag([
      { columnId: 'c1', values: ['x', 'y'] },
      { columnId: 'c2', values: ['z'] },
    ]);
    const b = crossFilterCacheTag([
      { columnId: 'c2', values: ['z'] },
      { columnId: 'c1', values: ['y', 'x'] },
    ]);

    expect(a).toBe(b);
  });
});

describe('parseCrossFilterParam', () => {
  it('entende ausência de filtro', () => {
    expect(parseCrossFilterParam(undefined)).toEqual([]);
  });

  it('não estoura com JSON quebrado vindo da URL', () => {
    expect(parseCrossFilterParam('[{"columnKey":')).toEqual([]);
  });

  it('recusa payload que não é lista', () => {
    expect(parseCrossFilterParam('{"columnKey":"prioridade","values":["x"]}')).toEqual([]);
  });

  it('lê a lista bem formada', () => {
    expect(parseCrossFilterParam('[{"columnKey":"prioridade","values":["Urgente"]}]')).toEqual([
      { columnKey: 'prioridade', values: ['Urgente'] },
    ]);
  });

  it('descarta item sem coluna', () => {
    expect(parseCrossFilterParam('[{"values":["Urgente"]}]')).toEqual([]);
  });

  it('descarta item cujos valores não são lista', () => {
    expect(parseCrossFilterParam('[{"columnKey":"prioridade","values":"Urgente"}]')).toEqual([]);
  });

  it('descarta valores que não são texto', () => {
    expect(parseCrossFilterParam('[{"columnKey":"prioridade","values":["Urgente",7,null]}]')).toEqual(
      [{ columnKey: 'prioridade', values: ['Urgente'] }],
    );
  });

  it('limita quantas colunas uma requisição pode filtrar', () => {
    const muitos = JSON.stringify(
      Array.from({ length: 80 }, (_, i) => ({ columnKey: `c${i}`, values: ['x'] })),
    );

    expect(parseCrossFilterParam(muitos).length).toBeLessThanOrEqual(40);
  });

  it('limita quantos valores uma coluna pode receber', () => {
    const muitos = JSON.stringify([
      { columnKey: 'prioridade', values: Array.from({ length: 500 }, (_, i) => `v${i}`) },
    ]);

    expect(parseCrossFilterParam(muitos)[0]!.values.length).toBeLessThanOrEqual(200);
  });
});
