import { describe, expect, it } from 'vitest';
import { isBlankPlanRow } from './plan-row-blank';

describe('isBlankPlanRow', () => {
  it('trata linha só com 0 como vazia', () => {
    expect(
      isBlankPlanRow({
        title: '0',
        fieldValues: [{ value: '0', column: { name: 'status' } }],
      }),
    ).toBe(true);
  });

  it('mantém linha com texto real', () => {
    expect(
      isBlankPlanRow({
        title: 'Ação 1',
        fieldValues: [{ value: 'pendente', column: { name: 'status' } }],
      }),
    ).toBe(false);
  });
});
