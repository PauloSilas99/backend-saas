import { describe, expect, it } from 'vitest';
import { assignCanonicalKeys, pickCanonicalKey } from './canonical-backfill';

describe('assignCanonicalKeys', () => {
  it('atribui a key casada pelo rótulo', () => {
    const result = assignCanonicalKeys([
      { id: 'a', label: 'STATUS ATUAL', sortOrder: 0 },
      { id: 'b', label: 'PRAZO (AÇÕES DE MELHORIA OU IMPLEMENTAÇÃO)', sortOrder: 1 },
    ]);
    expect(result).toEqual([
      { id: 'a', canonicalKey: 'status_atual' },
      { id: 'b', canonicalKey: 'prazo' },
    ]);
  });

  it('deixa null o rótulo fora do catálogo', () => {
    const result = assignCanonicalKeys([
      { id: 'a', label: 'COLUNA INVENTADA', sortOrder: 0 },
    ]);
    expect(result).toEqual([{ id: 'a', canonicalKey: null }]);
  });

  it('em colisão, fica com a coluna de menor sortOrder', () => {
    const result = assignCanonicalKeys([
      { id: 'tarde', label: 'situação', sortOrder: 7 },
      { id: 'cedo', label: 'STATUS ATUAL', sortOrder: 2 },
    ]);
    expect(result).toEqual([
      { id: 'tarde', canonicalKey: null },
      { id: 'cedo', canonicalKey: 'status_atual' },
    ]);
  });

  it('preserva a ordem de entrada na resposta', () => {
    const result = assignCanonicalKeys([
      { id: 'z', label: 'TURNO', sortOrder: 5 },
      { id: 'a', label: 'TEMA', sortOrder: 1 },
    ]);
    expect(result.map((r) => r.id)).toEqual(['z', 'a']);
  });

  it('não deixa duas colunas com a mesma key', () => {
    const result = assignCanonicalKeys([
      { id: 'a', label: 'AÇÕES', sortOrder: 0 },
      { id: 'b', label: 'acao', sortOrder: 1 },
      { id: 'c', label: 'título', sortOrder: 2 },
    ]);
    const keys = result.map((r) => r.canonicalKey).filter(Boolean);
    expect(keys).toEqual(['acoes']);
  });
});

describe('pickCanonicalKey', () => {
  it('devolve a key casada e a marca como ocupada', () => {
    const taken = new Set<string>();
    expect(pickCanonicalKey('STATUS ATUAL', taken)).toBe('status_atual');
    expect(taken.has('status_atual')).toBe(true);
  });

  it('devolve null quando a key já está ocupada no plano', () => {
    const taken = new Set(['status_atual']);
    expect(pickCanonicalKey('situação', taken)).toBeNull();
  });

  it('devolve null para rótulo fora do catálogo, sem sujar o conjunto', () => {
    const taken = new Set<string>();
    expect(pickCanonicalKey('COLUNA INVENTADA', taken)).toBeNull();
    expect(taken.size).toBe(0);
  });
});
