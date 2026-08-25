import { describe, expect, it } from 'vitest';
import { buildCells, cellsToFieldValues, mergeCells, withFieldValues } from './row-cells';

describe('row-cells', () => {
  const columns = new Map([
    ['status', { id: 'col-status' }],
    ['col-status', { id: 'col-status' }],
    ['obs', { id: 'col-obs' }],
  ]);

  it('builds cells keyed by column id and skips empty values', () => {
    expect(
      buildCells({ status: 'PENDING', obs: '  ', missing: 'x' }, columns),
    ).toEqual({ 'col-status': 'PENDING' });
  });

  it('merges patches and deletes cleared keys', () => {
    const merged = mergeCells(
      { 'col-status': 'PENDING', 'col-obs': 'antiga' },
      { obs: '', status: 'COMPLETED' },
      columns,
    );
    expect(merged).toEqual({ 'col-status': 'COMPLETED' });
  });

  it('exposes fieldValues in the API shape the front already reads', () => {
    expect(cellsToFieldValues({ 'col-status': 'PENDING', 'col-obs': '' })).toEqual([
      { columnId: 'col-status', value: 'PENDING' },
    ]);
    expect(withFieldValues({ id: '1', cells: { 'col-status': 'PENDING' } })).toEqual({
      id: '1',
      fieldValues: [{ columnId: 'col-status', value: 'PENDING' }],
    });
  });
});
