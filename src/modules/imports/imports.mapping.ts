export type SystemField = {
  key: string;
  label: string;
  required: boolean;
  type: 'string' | 'date' | 'enum';
  enumValues?: string[];
};

/** Campos de destino derivados do modelo ActionPlanRow. */
export const SYSTEM_FIELDS: SystemField[] = [
  { key: 'title', label: 'Título', required: true, type: 'string' },
  { key: 'description', label: 'Descrição', required: false, type: 'string' },
  { key: 'status', label: 'Status', required: true, type: 'enum' },
  { key: 'priority', label: 'Prioridade', required: true, type: 'enum' },
  { key: 'responsibleName', label: 'Responsável', required: true, type: 'string' },
  { key: 'unitName', label: 'Unidade', required: true, type: 'string' },
  { key: 'dueDate', label: 'Prazo', required: false, type: 'date' },
  { key: 'externalKey', label: 'Chave externa', required: false, type: 'string' },
];

export const REQUIRED_SYSTEM_FIELD_KEYS = SYSTEM_FIELDS.filter((f) => f.required).map(
  (f) => f.key,
);

export type ColumnMapping = Record<string, string>;

const HEADER_ALIASES: Record<string, string[]> = {
  title: ['titulo', 'título', 'title', 'acao', 'ação', 'action'],
  description: ['descricao', 'descrição', 'description', 'detalhe', 'observacao'],
  status: ['status', 'situacao', 'situação', 'estado'],
  priority: ['prioridade', 'priority', 'urgencia', 'urgência'],
  responsibleName: ['responsavel', 'responsável', 'responsible', 'owner', 'assignee'],
  unitName: ['unidade', 'unit', 'area', 'área', 'departamento'],
  dueDate: ['prazo', 'duedate', 'due_date', 'data', 'vencimento', 'deadline'],
  externalKey: ['chave', 'key', 'externalkey', 'external_key', 'id', 'codigo', 'código'],
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/_/g, '');
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;

  let matches = 0;
  const minLen = Math.min(na.length, nb.length);
  for (let i = 0; i < minLen; i += 1) {
    if (na[i] === nb[i]) matches += 1;
  }
  return matches / maxLen;
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedHeaders = new Set<string>();

  for (const field of SYSTEM_FIELDS) {
    const aliases = HEADER_ALIASES[field.key] ?? [field.key];
    let bestHeader: string | null = null;
    let bestScore = 0;

    for (const header of headers) {
      if (usedHeaders.has(header)) continue;

      const candidates = [...aliases, field.label, field.key];
      for (const candidate of candidates) {
        const score = similarity(header, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestHeader = header;
        }
      }
    }

    if (bestHeader && bestScore >= 0.6) {
      mapping[bestHeader] = field.key;
      usedHeaders.add(bestHeader);
    }
  }

  return mapping;
}

export function validateMappingCompleteness(mapping: ColumnMapping): string[] {
  const mappedFields = new Set(Object.values(mapping));
  return REQUIRED_SYSTEM_FIELD_KEYS.filter((key) => !mappedFields.has(key));
}

export function applyMapping(
  rawRow: Record<string, string>,
  mapping: ColumnMapping,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    const value = rawRow[header];
    if (value !== undefined && value !== '') {
      result[fieldKey] = value;
    }
  }
  return result;
}
