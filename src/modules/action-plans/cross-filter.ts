import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const UNFILLED_LABEL = 'Não informado';

export type CrossFilter = { columnKey: string; values: string[] };

export type CrossFilterColumn = { id: string; name: string; canonicalKey: string | null };

export type ResolvedCrossFilter = { columnId: string; values: string[] };

function findColumn(
  columnKey: string,
  columns: CrossFilterColumn[],
): CrossFilterColumn | undefined {
  const wanted = columnKey.trim();
  if (!wanted) return undefined;
  return (
    columns.find((col) => col.canonicalKey === wanted) ??
    columns.find((col) => col.name === wanted) ??
    columns.find((col) => col.id === wanted)
  );
}

export function resolveCrossFilters(
  filters: CrossFilter[],
  columns: CrossFilterColumn[],
): ResolvedCrossFilter[] {
  const valuesByColumnId = new Map<string, string[]>();

  for (const filter of filters) {
    const column = findColumn(filter.columnKey, columns);
    if (!column) continue;

    const cleaned = filter.values.map((value) => value.trim()).filter((value) => value.length > 0);
    if (cleaned.length === 0) continue;

    const accumulated = valuesByColumnId.get(column.id) ?? [];
    for (const value of cleaned) {
      if (!accumulated.includes(value)) accumulated.push(value);
    }
    valuesByColumnId.set(column.id, accumulated);
  }

  return Array.from(valuesByColumnId.entries()).map(([columnId, values]) => ({
    columnId,
    values,
  }));
}

export function buildCrossFilterSql(filters: ResolvedCrossFilter[]): Prisma.Sql {
  if (filters.length === 0) return Prisma.empty;

  return Prisma.join(
    filters.map(
      (filter) =>
        Prisma.sql`AND COALESCE(NULLIF(TRIM(r.cells ->> ${filter.columnId}), ''), ${UNFILLED_LABEL}) IN (${Prisma.join(filter.values)})`,
    ),
    ' ',
  );
}

export function crossFilterCacheTag(filters: ResolvedCrossFilter[]): string {
  if (filters.length === 0) return '';

  const normalized = filters
    .map((filter) => `${filter.columnId}=${[...filter.values].sort().join('|')}`)
    .sort()
    .join(';');

  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

const MAX_FILTERED_COLUMNS = 40;
const MAX_VALUES_PER_COLUMN = 200;

export function parseCrossFilterParam(raw: unknown): CrossFilter[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const filters: CrossFilter[] = [];
  for (const item of parsed.slice(0, MAX_FILTERED_COLUMNS)) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { columnKey?: unknown; values?: unknown };
    if (typeof candidate.columnKey !== 'string') continue;
    if (!Array.isArray(candidate.values)) continue;

    const values = candidate.values
      .filter((value): value is string => typeof value === 'string')
      .slice(0, MAX_VALUES_PER_COLUMN);

    filters.push({ columnKey: candidate.columnKey, values });
  }

  return filters;
}
