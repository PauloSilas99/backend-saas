import { ActionPriority, ActionStatus } from '@prisma/client';
import { normalizeHeader } from '@modules/columns/canonical-catalog';

export type StatusAtual =
  | 'no prazo'
  | 'em atraso'
  | 'concluído'
  | 'cancelado'
  | 'sem prazo';

export type StatusFinal =
  | 'concluída no prazo'
  | 'concluída em atraso'
  | 'concluída'
  | 'cancelada';

export type ProjectRowInput = {
  cells: Record<string, unknown>;
  columns: Array<{ id: string; canonicalKey: string | null }>;
  currentStatus?: ActionStatus;
  now?: Date;
};

export type ProjectedRow = {
  title: string;
  status: ActionStatus;
  priority: ActionPriority;
  dueDate: Date | null;
  completedAt: Date | null;
  responsibleName: string | null;
  unitName: string | null;
  statusAtual: StatusAtual;
  statusFinal: StatusFinal | null;
};

const STATUS_TO_ENUM: Record<StatusAtual, ActionStatus> = {
  'no prazo': ActionStatus.PENDING,
  'em atraso': ActionStatus.DELAYED,
  concluído: ActionStatus.COMPLETED,
  cancelado: ActionStatus.CANCELED,
  'sem prazo': ActionStatus.PENDING,
};

const WORKFLOW_STATUSES: ReadonlySet<ActionStatus> = new Set([
  ActionStatus.IN_PROGRESS,
  ActionStatus.WAITING_APPROVAL,
  ActionStatus.REJECTED,
]);

const PRIORITY_BY_VALUE: Record<string, ActionPriority> = {
  critica: ActionPriority.CRITICAL,
  critical: ActionPriority.CRITICAL,
  alta: ActionPriority.HIGH,
  high: ActionPriority.HIGH,
  media: ActionPriority.MEDIUM,
  medium: ActionPriority.MEDIUM,
  baixa: ActionPriority.LOW,
  low: ActionPriority.LOW,
};

export function parseDateOnly(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDayUtc(reference: Date): Date {
  return new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()),
  );
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function projectRow(input: ProjectRowInput): ProjectedRow {
  const { cells, columns, currentStatus, now = new Date() } = input;

  const byKey = new Map<string, unknown>();
  for (const column of columns) {
    if (column.canonicalKey) byKey.set(column.canonicalKey, cells[column.id]);
  }
  const value = (key: string) => text(byKey.get(key));

  const dueDate = parseDateOnly(byKey.get('prazo'));
  const completedAt = parseDateOnly(byKey.get('data_conclusao'));
  const canceled = normalizeHeader(value('status_atual')) === 'cancelado';

  const statusAtual = ((): StatusAtual => {
    if (canceled) return 'cancelado';
    if (completedAt) return 'concluído';
    if (!dueDate) return 'sem prazo';
    return dueDate < startOfDayUtc(now) ? 'em atraso' : 'no prazo';
  })();

  const statusFinal = ((): StatusFinal | null => {
    if (canceled) return 'cancelada';
    if (!completedAt) return null;
    if (!dueDate) return 'concluída';
    return completedAt <= dueDate ? 'concluída no prazo' : 'concluída em atraso';
  })();

  const projected = STATUS_TO_ENUM[statusAtual];
  const keepsWorkflow =
    currentStatus !== undefined &&
    WORKFLOW_STATUSES.has(currentStatus) &&
    projected === ActionStatus.PENDING;

  return {
    title: value('acoes'),
    status: keepsWorkflow ? currentStatus : projected,
    priority: PRIORITY_BY_VALUE[normalizeHeader(value('prioridade'))] ?? ActionPriority.MEDIUM,
    dueDate,
    completedAt,
    responsibleName: value('responsavel_solucao') || null,
    unitName: value('unidade') || null,
    statusAtual,
    statusFinal,
  };
}
