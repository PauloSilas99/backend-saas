import { describe, expect, it } from 'vitest';
import { ColumnFieldType, ColumnSemanticRole } from '@prisma/client';
import { inferSemanticRole, pickUniqueSemanticRoles } from './column-semantics';

describe('column-semantics', () => {
  it('infere prazo e responsável a partir do rótulo', () => {
    expect(
      inferSemanticRole({ name: 'data_fim', label: 'Prazo', fieldType: ColumnFieldType.DATE }),
    ).toBe(ColumnSemanticRole.DUE_DATE);
    expect(
      inferSemanticRole({
        name: 'prazo_acoes_de_melhoria_ou_implementacao',
        label: 'PRAZO (AÇÕES DE MELHORIA OU IMPLEMENTAÇÃO)',
        fieldType: ColumnFieldType.DATE,
      }),
    ).toBe(ColumnSemanticRole.DUE_DATE);
    expect(
      inferSemanticRole({
        name: 'acoes',
        label: 'AÇÕES / MEDIDA(S) DE CONTROLE',
        fieldType: ColumnFieldType.LONG_TEXT,
      }),
    ).toBe(ColumnSemanticRole.TITLE);
    expect(
      inferSemanticRole({
        name: 'data_criacao',
        label: 'DATA CRIAÇÃO',
        fieldType: ColumnFieldType.DATE,
      }),
    ).toBe(ColumnSemanticRole.NONE);
    expect(
      inferSemanticRole({
        name: 'responsavel',
        label: 'Responsável',
        fieldType: ColumnFieldType.TEXT,
      }),
    ).toBe(ColumnSemanticRole.ASSIGNEE);
  });

  it('mantém só a primeira coluna de cada papel', () => {
    const picked = pickUniqueSemanticRoles([
      { semanticRole: ColumnSemanticRole.DUE_DATE },
      { semanticRole: ColumnSemanticRole.DUE_DATE },
      { semanticRole: ColumnSemanticRole.ASSIGNEE },
    ]);
    expect(picked.map((c) => c.semanticRole)).toEqual([
      ColumnSemanticRole.DUE_DATE,
      ColumnSemanticRole.NONE,
      ColumnSemanticRole.ASSIGNEE,
    ]);
  });
});
