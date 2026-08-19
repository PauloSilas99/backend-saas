import { ColumnFieldType, ColumnSemanticRole } from '@prisma/client';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_');
}

const TITLE_KEYS = ['title', 'titulo', 'acao_corretiva', 'registro', 'acao'];
const STATUS_KEYS = ['status', 'situacao'];
const PRIORITY_KEYS = ['prioridade', 'priority'];
const DUE_KEYS = ['data_fim', 'prazo', 'due_date', 'duedate', 'vencimento', 'data_limite', 'deadline'];
const ASSIGNEE_KEYS = ['responsavel', 'responsible', 'assignee', 'owner', 'executor'];

function matches(haystack: string, keys: string[]): boolean {
  return keys.some((key) => haystack === key || haystack.includes(key));
}

/**
 * Infere o papel nativo da coluna a partir do nome/rótulo/tipo.
 * Só a primeira coluna de cada papel deve ser persistida (o caller deduplica).
 */
export function inferSemanticRole(input: {
  name: string;
  label?: string;
  fieldType?: ColumnFieldType;
}): ColumnSemanticRole {
  const blob = normalize(`${input.name} ${input.label ?? ''}`);

  if (matches(blob, DUE_KEYS) || input.fieldType === ColumnFieldType.DATE && matches(blob, ['fim', 'prazo'])) {
    return ColumnSemanticRole.DUE_DATE;
  }
  if (matches(blob, ASSIGNEE_KEYS) || input.fieldType === ColumnFieldType.USER) {
    return ColumnSemanticRole.ASSIGNEE;
  }
  if (matches(blob, TITLE_KEYS)) return ColumnSemanticRole.TITLE;
  if (matches(blob, STATUS_KEYS)) return ColumnSemanticRole.STATUS;
  if (matches(blob, PRIORITY_KEYS)) return ColumnSemanticRole.PRIORITY;
  if (input.fieldType === ColumnFieldType.DATE && matches(blob, ['data'])) {
    return ColumnSemanticRole.DUE_DATE;
  }
  return ColumnSemanticRole.NONE;
}

export function pickUniqueSemanticRoles<T extends { semanticRole?: ColumnSemanticRole }>(
  columns: T[],
): T[] {
  const used = new Set<ColumnSemanticRole>();
  return columns.map((col) => {
    const role = col.semanticRole ?? ColumnSemanticRole.NONE;
    if (role === ColumnSemanticRole.NONE || used.has(role)) {
      return { ...col, semanticRole: ColumnSemanticRole.NONE };
    }
    used.add(role);
    return { ...col, semanticRole: role };
  });
}
