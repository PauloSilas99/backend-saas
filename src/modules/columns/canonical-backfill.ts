import { matchCanonical } from './canonical-catalog';

export type BackfillColumn = {
  id: string;
  label: string;
  sortOrder: number;
};

export type CanonicalAssignment = {
  id: string;
  canonicalKey: string | null;
};

export function assignCanonicalKeys(columns: BackfillColumn[]): CanonicalAssignment[] {
  const winnerByKey = new Map<string, BackfillColumn>();

  for (const column of columns) {
    const key = matchCanonical(column.label);
    if (!key) continue;
    const current = winnerByKey.get(key);
    if (!current || column.sortOrder < current.sortOrder) {
      winnerByKey.set(key, column);
    }
  }

  const keyByColumnId = new Map<string, string>();
  for (const [key, column] of winnerByKey) keyByColumnId.set(column.id, key);

  return columns.map((column) => ({
    id: column.id,
    canonicalKey: keyByColumnId.get(column.id) ?? null,
  }));
}

export function pickCanonicalKey(label: string, taken: Set<string>): string | null {
  const key = matchCanonical(label);
  if (!key || taken.has(key)) return null;
  taken.add(key);
  return key;
}
