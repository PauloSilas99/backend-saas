import { Prisma } from '@prisma/client';
import { isTrivialCellValue } from './trivial-cell';

type FieldValue = {
  value: Prisma.JsonValue | null;
  column?: { name: string } | null;
};

export type PlanRowBlankInput = {
  title?: string | null;
  description?: string | null;
  responsibleName?: string | null;
  unitName?: string | null;
  dueDate?: Date | null;
  fieldValues?: FieldValue[];
  cells?: Prisma.JsonValue | Record<string, unknown> | null;
  autoColumnIds?: Set<string>;
};

export const AUTO_COLUMN_NAMES = new Set(['registro', 'data_criacao', 'id']);
const PLACEHOLDER_TITLE = /^(Linha \d+|Nova ação|Ação sem título|Registro \d+|ID-[A-Z0-9]+)$/i;

function jsonToString(value: Prisma.JsonValue | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Linha sem conteúdo útil nas colunas (título automático da importação não conta). */
export function isBlankPlanRow(row: PlanRowBlankInput): boolean {
  if (row.dueDate) return false;
  if (row.description?.trim() && !isTrivialCellValue(row.description)) return false;
  if (row.responsibleName?.trim() && !isTrivialCellValue(row.responsibleName)) return false;
  if (row.unitName?.trim() && !isTrivialCellValue(row.unitName)) return false;

  const hasFieldValue = (row.fieldValues ?? []).some((fv) => {
    const name = fv.column?.name?.trim().toLowerCase() ?? '';
    if (AUTO_COLUMN_NAMES.has(name)) return false;
    return !isTrivialCellValue(jsonToString(fv.value));
  });
  if (hasFieldValue) return false;

  if (row.cells && typeof row.cells === 'object' && !Array.isArray(row.cells)) {
    const hasCell = Object.entries(row.cells).some(([columnId, value]) => {
      if (row.autoColumnIds?.has(columnId)) return false;
      return !isTrivialCellValue(jsonToString(value as Prisma.JsonValue));
    });
    if (hasCell) return false;
  }

  const title = row.title?.trim() ?? '';
  if (!title || isTrivialCellValue(title)) return true;
  return PLACEHOLDER_TITLE.test(title);
}
