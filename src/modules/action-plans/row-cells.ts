import { Prisma } from '@prisma/client';

export type FieldValueDto = {
  columnId: string;
  value: Prisma.JsonValue;
};

export type NamedFieldValue = {
  value: Prisma.JsonValue;
  column: { name: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asCellsRecord(cells: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return isRecord(cells) ? { ...cells } : {};
}

export function isEmptyCell(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  return false;
}

export function cellsToFieldValues(cells: Prisma.JsonValue | null | undefined): FieldValueDto[] {
  return Object.entries(asCellsRecord(cells))
    .filter(([, value]) => !isEmptyCell(value))
    .map(([columnId, value]) => ({
      columnId,
      value: value as Prisma.JsonValue,
    }));
}

export function cellsToNamedFieldValues(
  cells: Prisma.JsonValue | null | undefined,
  columns: Array<{ id: string; name: string }>,
): NamedFieldValue[] {
  const record = asCellsRecord(cells);
  const result: NamedFieldValue[] = [];
  for (const column of columns) {
    const value = record[column.id];
    if (isEmptyCell(value)) continue;
    result.push({ value: value as Prisma.JsonValue, column: { name: column.name } });
  }
  return result;
}

export function buildCells(
  values: Record<string, unknown> | undefined,
  columnByKey: Map<string, { id: string }>,
): Record<string, Prisma.InputJsonValue> {
  const cells: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const column = columnByKey.get(key);
    if (!column || isEmptyCell(raw)) continue;
    cells[column.id] = raw as Prisma.InputJsonValue;
  }
  return cells;
}

export function mergeCells(
  current: Prisma.JsonValue | null | undefined,
  values: Record<string, unknown>,
  columnByKey: Map<string, { id: string }>,
): Record<string, Prisma.InputJsonValue> {
  const next: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, raw] of Object.entries(asCellsRecord(current))) {
    if (isEmptyCell(raw)) continue;
    next[key] = raw as Prisma.InputJsonValue;
  }
  for (const [key, raw] of Object.entries(values)) {
    const column = columnByKey.get(key);
    if (!column) continue;
    if (isEmptyCell(raw)) {
      delete next[column.id];
    } else {
      next[column.id] = raw as Prisma.InputJsonValue;
    }
  }
  return next;
}

export function withFieldValues<T extends { cells?: Prisma.JsonValue | null }>(
  row: T,
): Omit<T, 'cells'> & { fieldValues: FieldValueDto[] } {
  const { cells, ...rest } = row;
  return {
    ...(rest as Omit<T, 'cells'>),
    fieldValues: cellsToFieldValues(cells),
  };
}
