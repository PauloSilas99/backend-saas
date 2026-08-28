import {
  CANONICAL_COLUMNS,
  canonicalByKey,
  matchCanonical,
  normalizeHeader,
} from '@modules/columns/canonical-catalog';
import { parseDateOnly } from '@modules/action-plans/project-row';

export type HeaderReport = {
  matched: Array<{ header: string; canonicalKey: string; column: string }>;
  unmatched: Array<{ header: string; colIndex: number }>;
  missing: Array<{ canonicalKey: string; label: string }>;
};

export function buildHeaderReport(headers: string[]): HeaderReport {
  const matched: HeaderReport['matched'] = [];
  const unmatched: HeaderReport['unmatched'] = [];
  const taken = new Set<string>();

  headers.forEach((header, colIndex) => {
    if (!header?.trim()) return;
    const key = matchCanonical(header);
    if (key && !taken.has(key)) {
      taken.add(key);
      matched.push({ header, canonicalKey: key, column: canonicalByKey(key)!.column });
      return;
    }
    unmatched.push({ header, colIndex });
  });

  const missing = CANONICAL_COLUMNS.filter((column) => !taken.has(column.key)).map((column) => ({
    canonicalKey: column.key,
    label: column.label,
  }));

  return { matched, unmatched, missing };
}

export function missingRowKeys(
  existingKeys: Array<string | null>,
  keysInFile: string[],
): string[] {
  const seen = new Set(keysInFile);
  return existingKeys.filter((key): key is string => Boolean(key) && !seen.has(key as string));
}

export type RowIssueSeverity = 'ERROR' | 'WARNING';

export type RowIssue = {
  severity: RowIssueSeverity;
  code: 'TITLE_REQUIRED' | 'INVALID_DATE' | 'MISSING_DUE_DATE' | 'VALUE_OUT_OF_VOCABULARY';
  message: string;
};

export function validateRowValues(canonicalValues: Record<string, string>): RowIssue[] {
  const issues: RowIssue[] = [];
  const value = (key: string) => (canonicalValues[key] ?? '').trim();

  if (!value('acoes')) {
    issues.push({
      severity: 'ERROR',
      code: 'TITLE_REQUIRED',
      message: 'A coluna AÇÕES está vazia — sem ela não há ação a registrar.',
    });
  }

  for (const column of CANONICAL_COLUMNS) {
    const raw = value(column.key);

    if (column.fieldType === 'DATE' && raw && !parseDateOnly(raw)) {
      issues.push({
        severity: 'ERROR',
        code: 'INVALID_DATE',
        message: `Data não reconhecida em ${column.label}: "${raw}".`,
      });
    }

    if (column.vocabulary?.length && raw && !column.systemManaged) {
      const accepted = column.vocabulary.map(normalizeHeader);
      if (!accepted.includes(normalizeHeader(raw))) {
        issues.push({
          severity: 'WARNING',
          code: 'VALUE_OUT_OF_VOCABULARY',
          message: `Valor fora da lista em ${column.label}: "${raw}".`,
        });
      }
    }
  }

  if (!value('prazo')) {
    issues.push({
      severity: 'WARNING',
      code: 'MISSING_DUE_DATE',
      message: 'Sem PRAZO a ação não entra nos indicadores de pontualidade.',
    });
  }

  return issues;
}
