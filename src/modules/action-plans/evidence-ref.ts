import { ValidationError } from '@shared/errors/AppError';
export type EvidenceKindName = 'LINK' | 'TEXTO' | 'ARQUIVO';

export type EvidenceRef =
  | { kind: 'LINK'; value: string }
  | { kind: 'TEXTO'; value: string }
  | { kind: 'ARQUIVO'; evidenceId: string };

const MAX_CELL_TEXT = 300;

const PREFIX_BY_KIND: Record<EvidenceKindName, string> = {
  LINK: 'link',
  TEXTO: 'texto',
  ARQUIVO: 'arquivo',
};

const KIND_BY_PREFIX: Record<string, EvidenceKindName> = {
  link: 'LINK',
  texto: 'TEXTO',
  arquivo: 'ARQUIVO',
};

export function encodeEvidenceRef(ref: EvidenceRef): string {
  const prefix = PREFIX_BY_KIND[ref.kind];
  if (ref.kind === 'ARQUIVO') return `${prefix}:${ref.evidenceId}`;
  const body =
    ref.kind === 'TEXTO' ? ref.value.slice(0, MAX_CELL_TEXT - prefix.length - 1) : ref.value;
  return `${prefix}:${body}`;
}

export function decodeEvidenceRef(raw: string): EvidenceRef | null {
  const separator = raw.indexOf(':');
  if (separator <= 0) return null;

  const kind = KIND_BY_PREFIX[raw.slice(0, separator)];
  const body = raw.slice(separator + 1).trim();
  if (!kind || !body) return null;

  return kind === 'ARQUIVO' ? { kind, evidenceId: body } : { kind, value: body };
}

export type EvidenceInput =
  | { kind: 'LINK'; value: string }
  | { kind: 'TEXTO'; value: string }
  | { kind: 'ARQUIVO'; evidenceId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeEvidenceInput(raw: unknown): EvidenceInput | null {
  if (isRecord(raw)) {
    if (raw.kind === 'ARQUIVO' && typeof raw.evidenceId === 'string') {
      return { kind: 'ARQUIVO', evidenceId: raw.evidenceId };
    }
    if ((raw.kind === 'LINK' || raw.kind === 'TEXTO') && typeof raw.value === 'string') {
      return { kind: raw.kind, value: raw.value };
    }
    return null;
  }

  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('data:')) {
    throw new ValidationError(
      'Anexe o arquivo pelo endpoint de evidência em vez de enviá-lo embutido.',
    );
  }

  return /^https?:\/\//i.test(value)
    ? { kind: 'LINK', value }
    : { kind: 'TEXTO', value };
}
