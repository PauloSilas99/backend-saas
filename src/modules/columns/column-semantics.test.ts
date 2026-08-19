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
