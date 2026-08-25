import { normalizeDateValue } from './sheet-cells';

function foldName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Ordem: prazo real primeiro; data de criação só como último recurso. */
const DUE_NAME_PRIORITY: RegExp[] = [
  /^data_fim$/,
  /^prazo$/,
  /^prazo_/,
  /data_conclusao/,
  /data_prox/,
  /vencimento/,
  /data_limite/,
  /deadline/,
  /due_date/,
  /^data_verificacao$/,
  /data_criacao/,
];

export function parseDueDateString(raw: string | undefined | null): Date | undefined {
  if (!raw?.trim()) return undefined;
  const parsed = normalizeDateValue(raw);
  if (!parsed.ok || !parsed.value) return undefined;
  const date = new Date(`${parsed.value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function pickDueDateFromNamedValues(
  values: Record<string, string | undefined | null>,
): Date | undefined {
  const entries = Object.entries(values).map(([name, value]) => ({
    name: foldName(name),
    value: String(value ?? ''),
  }));

  for (const pattern of DUE_NAME_PRIORITY) {
    for (const entry of entries) {
      if (!pattern.test(entry.name)) continue;
      const date = parseDueDateString(entry.value);
      if (date) return date;
    }
  }
  return undefined;
}

export type CalendarDateKind = 'ocorrencia' | 'inicio' | 'prazo';

export function classifyCalendarDateColumn(name: string): CalendarDateKind | null {
  const folded = foldName(name);
  if (folded === 'data_ocorrencia' || folded.includes('data_criacao')) return 'ocorrencia';
  if (
    folded === 'data_inicio' ||
    folded.startsWith('data_inicio') ||
    (folded.includes('data_verificacao') && !folded.includes('prox')) ||
    folded.includes('data_prox')
  ) {
    return 'inicio';
  }
  if (
    folded === 'data_fim' ||
    folded.startsWith('data_fim') ||
    folded === 'prazo' ||
    folded.startsWith('prazo_') ||
    folded.includes('data_conclusao') ||
    folded.includes('vencimento') ||
    folded.includes('data_limite')
  ) {
    return 'prazo';
  }
  if (folded.startsWith('data_') || folded.includes('prazo')) return 'prazo';
  return null;
}
