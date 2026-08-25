import { Prisma } from '@prisma/client';
import { PRODUCT_LIMITS } from '@shared/limits/product-limits';

export type UserChartType = 'pie' | 'bar' | 'line';
export type UserChartAggregation = 'count' | 'sum';

export type UserChartSpec = {
  id: string;
  title: string;
  type: UserChartType;
  columnKey: string;
  aggregation: UserChartAggregation;
  valueColumnKey?: string;
};

export type UserChartSlice = {
  label: string;
  value: number;
  sortKey?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asChartsMap(raw: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return isRecord(raw) ? { ...raw } : {};
}

function asString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function sanitizeUserChartSpec(raw: unknown): UserChartSpec | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, 80);
  const title = asString(raw.title, 120);
  const columnKey = asString(raw.columnKey, 80);
  const type = raw.type === 'pie' || raw.type === 'bar' || raw.type === 'line' ? raw.type : null;
  const aggregation: UserChartAggregation = raw.aggregation === 'sum' ? 'sum' : 'count';
  if (!id || !title || !columnKey || !type) return null;
  const valueColumnKey = asString(raw.valueColumnKey, 80) ?? undefined;
  return {
    id,
    title,
    type,
    columnKey,
    aggregation,
    ...(aggregation === 'sum' && valueColumnKey ? { valueColumnKey } : {}),
  };
}

export function sanitizeUserCharts(raw: unknown): UserChartSpec[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const charts: UserChartSpec[] = [];
  for (const item of raw) {
    const spec = sanitizeUserChartSpec(item);
    if (!spec || seen.has(spec.id)) continue;
    seen.add(spec.id);
    charts.push(spec);
    if (charts.length >= PRODUCT_LIMITS.maxUserChartsPerSheet) break;
  }
  return charts;
}

export function chartsForSheet(
  raw: Prisma.JsonValue | null | undefined,
  sheetId: string,
): UserChartSpec[] {
  const map = asChartsMap(raw);
  return sanitizeUserCharts(map[sheetId]);
}

export function mergeSheetCharts(
  raw: Prisma.JsonValue | null | undefined,
  sheetId: string,
  charts: UserChartSpec[],
): Record<string, unknown> {
  const map = asChartsMap(raw);
  map[sheetId] = charts;
  return map;
}
