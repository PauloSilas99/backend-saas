import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { randomUUID } from 'crypto';
import { env } from '@config/env';
import { NotFoundError, ValidationError } from '@shared/errors/AppError';
import {
  headersFromRow,
  peekSpreadsheetFile,
  recordsFromPeek,
  streamSpreadsheetFile,
  type SpreadsheetPeekRow,
  type SpreadsheetStreamHandlers,
  type SpreadsheetStreamOptions,
} from './parse/spreadsheet';

export const PARSE_SAMPLE_ROWS = 50;
export const PARSE_DISTINCT_CAP = 80;

const SOURCE_EXTS = ['.xlsx', '.xls', '.csv'] as const;
const PARSE_TTL_MS = 6 * 60 * 60 * 1000;

export type SheetParseMeta = {
  parseId: string;
  tenantId: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  emptyColumns: string[];
  /** 0 enquanto só a amostra foi lida; o total sai na 2ª passagem. */
  totalRows: number;
  createdAt: string;
  distincts: Record<string, string[]>;
  truncated?: boolean;
  suggestedHeaderRow: number;
  peekRows: SpreadsheetPeekRow[];
  columnCount: number;
  sourceFileName: string;
};

function parsesRoot(): string {
  return path.resolve(process.cwd(), env.UPLOAD_DIR, 'sheet-parses');
}

function parseDir(tenantId: string, parseId: string): string {
  return path.join(parsesRoot(), tenantId, parseId);
}

function metaPath(tenantId: string, parseId: string): string {
  return path.join(parseDir(tenantId, parseId), 'meta.json');
}

function dataPath(tenantId: string, parseId: string): string {
  return path.join(parseDir(tenantId, parseId), 'data.jsonl');
}

export function ensureSheetParseDir(tenantId: string, parseId?: string): string {
  const dir = parseId
    ? parseDir(tenantId, parseId)
    : path.join(parsesRoot(), tenantId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sourceExtFromName(fileName: string, fallbackPath: string): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (SOURCE_EXTS.includes(fromName as (typeof SOURCE_EXTS)[number])) return fromName;
  const fromPath = path.extname(fallbackPath).toLowerCase();
  if (SOURCE_EXTS.includes(fromPath as (typeof SOURCE_EXTS)[number])) return fromPath;
  return '.xlsx';
}

function distinctsFromRecords(
  headers: string[],
  records: Record<string, string>[],
): { distincts: Record<string, string[]>; emptyColumns: string[] } {
  const filled = new Set<string>();
  const distincts = new Map<string, Set<string>>();

  for (const row of records) {
    for (const header of headers) {
      const value = row[header]?.trim() ?? '';
      if (!value) continue;
      filled.add(header);
      let set = distincts.get(header);
      if (!set) {
        set = new Set();
        distincts.set(header, set);
      }
      if (set.size < PARSE_DISTINCT_CAP) set.add(value);
    }
  }

  const distinctRecord: Record<string, string[]> = {};
  for (const [header, values] of distincts) {
    distinctRecord[header] = [...values];
  }

  return {
    distincts: distinctRecord,
    emptyColumns: headers.filter((header) => !filled.has(header)),
  };
}

/**
 * Passagem 1: copia o arquivo original e lê só o começo (cabeçalho + exemplos).
 * Não percorre nem materializa o restante das linhas.
 */
export async function saveSheetParseFromFile(input: {
  tenantId: string;
  fileName: string;
  filePath: string;
  onProgress?: (rows: number) => void;
}): Promise<SheetParseMeta> {
  const parseId = randomUUID();
  const dir = ensureSheetParseDir(input.tenantId, parseId);
  const sourceFileName = `source${sourceExtFromName(input.fileName, input.filePath)}`;
  const dest = path.join(dir, sourceFileName);

  try {
    await fs.promises.copyFile(input.filePath, dest);
    const peek = await peekSpreadsheetFile(dest);
    input.onProgress?.(peek.rows.length);

    const { headers, records } = recordsFromPeek(peek.rows, peek.suggestedHeaderRow);
    if (headers.length === 0) {
      throw new ValidationError('Cabeçalho vazio ou inválido');
    }

    const { distincts, emptyColumns } = distinctsFromRecords(headers, records);

    const meta: SheetParseMeta = {
      parseId,
      tenantId: input.tenantId,
      fileName: input.fileName,
      sheetName: peek.sheetName,
      headers,
      emptyColumns,
      totalRows: 0,
      createdAt: new Date().toISOString(),
      distincts,
      truncated: false,
      suggestedHeaderRow: peek.suggestedHeaderRow,
      peekRows: peek.rows,
      columnCount: peek.columnCount,
      sourceFileName,
    };

    await fs.promises.writeFile(metaPath(input.tenantId, parseId), JSON.stringify(meta), 'utf8');
    return meta;
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function resolveSheetParseSourcePath(meta: SheetParseMeta): string | null {
  const dir = parseDir(meta.tenantId, meta.parseId);
  if (meta.sourceFileName) {
    const named = path.join(dir, meta.sourceFileName);
    if (fs.existsSync(named)) return named;
  }
  for (const ext of SOURCE_EXTS) {
    const candidate = path.join(dir, `source${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function streamSheetParseSource(
  meta: SheetParseMeta,
  handlers: SpreadsheetStreamHandlers,
  options: SpreadsheetStreamOptions,
) {
  const sourcePath = resolveSheetParseSourcePath(meta);
  if (!sourcePath) {
    throw new NotFoundError(
      'Arquivo original da leitura não encontrado. Envie a planilha novamente.',
    );
  }
  return streamSpreadsheetFile(sourcePath, handlers, {
    headerRowIndex: options.headerRowIndex ?? meta.suggestedHeaderRow ?? 1,
    columnCount: options.columnCount ?? meta.columnCount ?? meta.headers.length,
  });
}

function normalizeMeta(raw: SheetParseMeta & { rows?: Record<string, string>[] }): SheetParseMeta {
  const peekRows = Array.isArray(raw.peekRows) ? raw.peekRows : [];
  const suggestedHeaderRow = raw.suggestedHeaderRow ?? 1;
  const headers =
    raw.headers?.length > 0
      ? raw.headers
      : headersFromRow(peekRows.find((row) => row.line === suggestedHeaderRow)?.values ?? []);

  return {
    parseId: raw.parseId,
    tenantId: raw.tenantId,
    fileName: raw.fileName,
    sheetName: raw.sheetName,
    headers,
    emptyColumns: raw.emptyColumns ?? [],
    totalRows: raw.totalRows ?? raw.rows?.length ?? 0,
    createdAt: raw.createdAt,
    distincts: raw.distincts ?? {},
    truncated: raw.truncated ?? false,
    suggestedHeaderRow,
    peekRows,
    columnCount: raw.columnCount ?? headers.length,
    sourceFileName: raw.sourceFileName ?? '',
  };
}

export async function loadSheetParseMeta(
  tenantId: string,
  parseId: string,
): Promise<SheetParseMeta> {
  const filePath = metaPath(tenantId, parseId);
  if (!fs.existsSync(filePath)) {
    const legacy = path.join(parsesRoot(), tenantId, `${parseId}.json`);
    if (fs.existsSync(legacy)) {
      const raw = JSON.parse(await fs.promises.readFile(legacy, 'utf8')) as SheetParseMeta & {
        rows?: Record<string, string>[];
      };
      return normalizeMeta(raw);
    }
    throw new NotFoundError(
      'Leitura da planilha expirada ou não encontrada. Envie o arquivo novamente.',
    );
  }

  let raw: SheetParseMeta;
  try {
    raw = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as SheetParseMeta;
  } catch {
    throw new ValidationError('Arquivo de leitura corrompido. Envie a planilha novamente.');
  }

  if (raw.tenantId !== tenantId) {
    throw new NotFoundError('Leitura da planilha não encontrada.');
  }

  const age = Date.now() - new Date(raw.createdAt).getTime();
  if (age > PARSE_TTL_MS) {
    void deleteSheetParse(tenantId, parseId);
    throw new NotFoundError('Leitura da planilha expirou. Envie o arquivo novamente.');
  }

  return normalizeMeta(raw);
}

export async function readSheetParseSample(
  tenantId: string,
  parseId: string,
  limit = PARSE_SAMPLE_ROWS,
): Promise<Record<string, string>[]> {
  const meta = await loadSheetParseMeta(tenantId, parseId);
  if (meta.peekRows.length > 0) {
    const { records } = recordsFromPeek(meta.peekRows, meta.suggestedHeaderRow);
    return records.slice(0, limit);
  }

  const filePath = dataPath(tenantId, parseId);
  if (!fs.existsSync(filePath)) {
    const legacy = path.join(parsesRoot(), tenantId, `${parseId}.json`);
    if (!fs.existsSync(legacy)) return [];
    const old = JSON.parse(await fs.promises.readFile(legacy, 'utf8')) as {
      rows?: Record<string, string>[];
    };
    return (old.rows ?? []).slice(0, limit);
  }

  const sample: Record<string, string>[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    sample.push(JSON.parse(line) as Record<string, string>);
    if (sample.length >= limit) {
      rl.close();
      stream.destroy();
      break;
    }
  }
  return sample;
}

export async function readSheetParseDistincts(
  tenantId: string,
  parseId: string,
  header: string,
  limit = PARSE_DISTINCT_CAP,
): Promise<string[]> {
  const meta = await loadSheetParseMeta(tenantId, parseId);
  const cached = meta.distincts?.[header];
  if (cached?.length) return cached.slice(0, limit);

  if (meta.peekRows.length > 0) {
    const { records } = recordsFromPeek(meta.peekRows, meta.suggestedHeaderRow);
    const values = new Set<string>();
    for (const row of records) {
      const value = row[header]?.trim();
      if (value) values.add(value);
      if (values.size >= limit) break;
    }
    return [...values];
  }

  const values = new Set<string>();
  for await (const batch of iterateSheetParseRows(tenantId, parseId, 500)) {
    for (const row of batch) {
      const value = row[header]?.trim();
      if (value) values.add(value);
      if (values.size >= limit) return [...values];
    }
  }
  return [...values];
}

/** Legado: JSONL gerado por parses antigos. A importação atual lê o arquivo original. */
export async function* iterateSheetParseRows(
  tenantId: string,
  parseId: string,
  batchSize = 500,
): AsyncGenerator<Record<string, string>[]> {
  const filePath = dataPath(tenantId, parseId);

  if (!fs.existsSync(filePath)) {
    const legacy = path.join(parsesRoot(), tenantId, `${parseId}.json`);
    if (!fs.existsSync(legacy)) return;
    const old = JSON.parse(await fs.promises.readFile(legacy, 'utf8')) as {
      rows?: Record<string, string>[];
    };
    const rows = old.rows ?? [];
    for (let i = 0; i < rows.length; i += batchSize) {
      yield rows.slice(i, i + batchSize);
    }
    return;
  }

  let batch: Record<string, string>[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line) as Record<string, string>);
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

export async function deleteSheetParse(tenantId: string, parseId: string): Promise<void> {
  const dir = parseDir(tenantId, parseId);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  const legacy = path.join(parsesRoot(), tenantId, `${parseId}.json`);
  try {
    await fs.promises.unlink(legacy);
  } catch {
    // ignore
  }
}
