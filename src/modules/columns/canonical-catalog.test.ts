import { describe, expect, it } from 'vitest';
import { CANONICAL_COLUMNS, matchCanonical, normalizeHeader } from './canonical-catalog';

describe('CANONICAL_COLUMNS', () => {
  it('cobre as 56 colunas da planilha base', () => {
    expect(CANONICAL_COLUMNS).toHaveLength(56);
  });

  it('não repete key', () => {
    const keys = CANONICAL_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('não repete letra de coluna', () => {
    const cols = CANONICAL_COLUMNS.map((c) => c.column);
    expect(new Set(cols).size).toBe(cols.length);
  });

  it('atribui cada role a no máximo uma coluna', () => {
    const roles = CANONICAL_COLUMNS.map((c) => c.role).filter(Boolean);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('começa em A e termina em BD, na ordem do arquivo', () => {
    expect(CANONICAL_COLUMNS[0].column).toBe('A');
    expect(CANONICAL_COLUMNS[55].column).toBe('BD');
  });
});

describe('normalizeHeader', () => {
  it('remove diacríticos', () => {
    expect(normalizeHeader('GERÊNCIA')).toBe('gerencia');
  });

  it('colapsa pontuação e espaço repetido num separador só', () => {
    expect(normalizeHeader('TEMPO DE EXPOSIÇÃO (EM  MINUTOS)')).toBe(
      'tempo_de_exposicao_em_minutos',
    );
  });
});

describe('matchCanonical', () => {
  it('reconhece AÇÕES (AF) como a ação do plano', () => {
    expect(matchCanonical('AÇÕES')).toBe('acoes');
  });

  it('reconhece AÇÕES / MEDIDA(S) DE CONTROLE (S) como medida de controle, não como a ação', () => {
    expect(matchCanonical('AÇÕES / MEDIDA(S) DE CONTROLE')).toBe('medidas_controle');
  });

  it('ignora acento e caixa', () => {
    expect(matchCanonical('data conclusao')).toBe('data_conclusao');
  });

  it('casa cabeçalho digitado sem acento contra o rótulo acentuado', () => {
    expect(matchCanonical('POSIVEIS LESOES / AGRAVOS A SAUDE')).toBe('possiveis_lesoes');
  });

  it('distingue as duas colunas de status', () => {
    expect(matchCanonical('STATUS ATUAL')).toBe('status_atual');
    expect(matchCanonical('STATUS FINAL')).toBe('status_final');
  });

  it('aceita o typo do arquivo do cliente e a grafia correta', () => {
    expect(matchCanonical('ELININARÁ O PERIGO?')).toBe('eliminara_perigo');
    expect(matchCanonical('ELIMINARÁ O PERIGO?')).toBe('eliminara_perigo');
  });

  it('casa o prazo pelo cabeçalho longo e pelos apelidos', () => {
    expect(matchCanonical('PRAZO (AÇÕES DE MELHORIA OU IMPLEMENTAÇÃO)')).toBe('prazo');
    expect(matchCanonical('data_fim')).toBe('prazo');
  });

  it('devolve null para cabeçalho fora do catálogo', () => {
    expect(matchCanonical('COLUNA INVENTADA PELO CLIENTE')).toBeNull();
  });
});
