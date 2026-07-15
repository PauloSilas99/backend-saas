import { ActionPriority, ActionStatus, ImportRowStatus } from '@prisma/client';
import { applyMapping, ColumnMapping } from './imports.mapping';

const STATUS_MAP: Record<string, ActionStatus> = {
  pendente: ActionStatus.PENDING,
  pending: ActionStatus.PENDING,
  'em andamento': ActionStatus.IN_PROGRESS,
  in_progress: ActionStatus.IN_PROGRESS,
  andamento: ActionStatus.IN_PROGRESS,
  concluido: ActionStatus.COMPLETED,
  concluído: ActionStatus.COMPLETED,
  completed: ActionStatus.COMPLETED,
  atrasado: ActionStatus.DELAYED,
  delayed: ActionStatus.DELAYED,
  cancelado: ActionStatus.CANCELED,
  canceled: ActionStatus.CANCELED,
};

const PRIORITY_MAP: Record<string, ActionPriority> = {
  baixa: ActionPriority.LOW,
  low: ActionPriority.LOW,
  media: ActionPriority.MEDIUM,
  média: ActionPriority.MEDIUM,
  medium: ActionPriority.MEDIUM,
  alta: ActionPriority.HIGH,
  high: ActionPriority.HIGH,
  critica: ActionPriority.CRITICAL,
  crítica: ActionPriority.CRITICAL,
  critical: ActionPriority.CRITICAL,
};

export type ValidatedRow = {
  lineNumber: number;
  rawData: Record<string, string>;
  mappedData: Record<string, unknown>;
  status: ImportRowStatus;
  messages: string[];
};

export type TenantValidationContext = {
  existingExternalKeys: Set<string>;
  existingTitles: Set<string>;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isValidDate(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateMappedRow(
  lineNumber: number,
  rawData: Record<string, string>,
  mapping: ColumnMapping,
  context: TenantValidationContext,
  sheetDuplicateTracker: Map<string, number[]>,
): ValidatedRow {
  const mapped = applyMapping(rawData, mapping);
  const messages: string[] = [];
  let status: ImportRowStatus = ImportRowStatus.OK;

  const title = String(mapped.title ?? '').trim();
  if (!title) {
    messages.push('Título obrigatório');
    status = ImportRowStatus.ERROR;
  }

  const statusRaw = String(mapped.status ?? '').trim();
  const normalizedStatus = normalize(statusRaw);
  if (!statusRaw) {
    messages.push('Status obrigatório');
    status = ImportRowStatus.ERROR;
  } else if (!STATUS_MAP[normalizedStatus]) {
    messages.push(`Status inválido: ${statusRaw}`);
    status = ImportRowStatus.ERROR;
  }

  const priorityRaw = String(mapped.priority ?? '').trim();
  const normalizedPriority = normalize(priorityRaw);
  if (!priorityRaw) {
    messages.push('Prioridade obrigatória');
    status = ImportRowStatus.ERROR;
  } else if (!PRIORITY_MAP[normalizedPriority]) {
    messages.push(`Prioridade inválida: ${priorityRaw}`);
    status = ImportRowStatus.ERROR;
  }

  const responsible = String(mapped.responsibleName ?? '').trim();
  if (!responsible) {
    messages.push('Responsável obrigatório');
    status = ImportRowStatus.ERROR;
  } else if (responsible.includes('@') && !isValidEmail(responsible)) {
    messages.push('E-mail do responsável inválido');
    status = ImportRowStatus.ERROR;
  }

  const unitName = String(mapped.unitName ?? '').trim();
  if (!unitName) {
    messages.push('Unidade obrigatória');
    status = ImportRowStatus.ERROR;
  }

  const dueDateRaw = String(mapped.dueDate ?? '').trim();
  if (dueDateRaw && !isValidDate(dueDateRaw)) {
    messages.push(`Data de prazo inválida: ${dueDateRaw}`);
    status = ImportRowStatus.ERROR;
  }

  const externalKey = String(mapped.externalKey ?? '').trim();
  const duplicateKey = externalKey || `${title}|${responsible}|${unitName}`;

  const sheetLines = sheetDuplicateTracker.get(duplicateKey) ?? [];
  sheetLines.push(lineNumber);
  sheetDuplicateTracker.set(duplicateKey, sheetLines);
  if (sheetLines.length > 1) {
    messages.push(`Duplicidade na planilha (linhas: ${sheetLines.join(', ')})`);
    status = ImportRowStatus.ERROR;
  }

  if (externalKey && context.existingExternalKeys.has(externalKey)) {
    messages.push(`Chave externa já cadastrada: ${externalKey}`);
    status = ImportRowStatus.WARNING;
  } else if (!externalKey && context.existingTitles.has(normalize(title))) {
    messages.push('Título já existente no banco — será feito merge por chave gerada');
    status = status === ImportRowStatus.ERROR ? status : ImportRowStatus.WARNING;
  }

  const mappedData: Record<string, unknown> = {
    title,
    description: mapped.description?.trim() || undefined,
    status: STATUS_MAP[normalizedStatus],
    priority: PRIORITY_MAP[normalizedPriority],
    responsibleName: responsible,
    unitName,
    dueDate: dueDateRaw || undefined,
    externalKey: externalKey || undefined,
  };

  return { lineNumber, rawData, mappedData, status, messages };
}

export { STATUS_MAP, PRIORITY_MAP, normalize as normalizeImportValue };
