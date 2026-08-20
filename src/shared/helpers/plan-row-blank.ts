import { Prisma } from '@prisma/client';

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
};

const PLACEHOLDER_TITLE = /^(Linha \d+|Nova ação|Ação sem título|Registro \d+|ID-[A-Z0-9]+)$/i;
const AUTO_COLUMN_NAMES = new Set(['registro', 'data_criacao', 'id']);

function jsonToString(value: Prisma.JsonValue | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Linha sem conteúdo útil nas colunas (título automático da importação não conta). */
export function isBlankPlanRow(row: PlanRowBlankInput): boolean {
  if (row.dueDate) return false;
  if (row.description?.trim()) return false;
  if (row.responsibleName?.trim()) return false;
  if (row.unitName?.trim()) return false;

  const hasFieldValue = (row.fieldValues ?? []).some((fv) => {
    const name = fv.column?.name?.trim().toLowerCase() ?? '';
    if (AUTO_COLUMN_NAMES.has(name)) return false;
    return jsonToString(fv.value).length > 0;
  });
  if (hasFieldValue) return false;

  const title = row.title?.trim() ?? '';
  if (!title) return true;
  return PLACEHOLDER_TITLE.test(title);
}
