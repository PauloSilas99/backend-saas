import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { randomUUID } from 'crypto';
import { env } from '@config/env';
import { NotFoundError, ValidationError } from '@shared/errors/AppError';

export type SheetParseMeta = {
  parseId: string;
  tenantId: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  emptyColumns: string[];
  totalRows: number;
  createdAt: string;
};

const PARSE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

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

/**
 * Grava metadados + linhas em JSONL (1 linha JSON por registro).
 * Evita um único JSON gigante em memória no import de 65k+.
 */
export async function saveSheetParse(input: {
  tenantId: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
  emptyColumns: string[];
}): Promise<SheetParseMeta> {
  const parseId = randomUUID();
  ensureSheetParseDir(input.tenantId, parseId);

  const meta: SheetParseMeta = {
    parseId,
    tenantId: input.tenantId,
    fileName: input.fileName,
    sheetName: input.sheetName,
    headers: input.headers,
    emptyColumns: input.emptyColumns,
    totalRows: input.rows.length,
    createdAt: new Date().toISOString(),
  };

  await fs.promises.writeFile(metaPath(input.tenantId, parseId), JSON.stringify(meta), 'utf8');

  const jsonl = input.rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.promises.writeFile(
    dataPath(input.tenantId, parseId),
    jsonl ? `${jsonl}\n` : '',
    'utf8',
  );

  return meta;
}

export async function loadSheetParseMeta(
  tenantId: string,
  parseId: string,
): Promise<SheetParseMeta> {
  const filePath = metaPath(tenantId, parseId);
  if (!fs.existsSync(filePath)) {
    // Compat: formato antigo (um único .json)
    const legacy = path.join(parsesRoot(), tenantId, `${parseId}.json`);
    if (fs.existsSync(legacy)) {
      const raw = await fs.promises.readFile(legacy, 'utf8');
      const old = JSON.parse(raw) as SheetParseMeta & { rows?: Record<string, string>[] };
      return {
        parseId: old.parseId,
        tenantId: old.tenantId,
        fileName: old.fileName,
        sheetName: old.sheetName,
        headers: old.headers,
        emptyColumns: old.emptyColumns ?? [],
        totalRows: old.totalRows ?? old.rows?.length ?? 0,
        createdAt: old.createdAt,
      };
    }
    throw new NotFoundError(
      'Leitura da planilha expirada ou não encontrada. Envie o arquivo novamente.',
    );
  }

  let meta: SheetParseMeta;
  try {
    meta = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as SheetParseMeta;
  } catch {
    throw new ValidationError('Arquivo de leitura corrompido. Envie a planilha novamente.');
  }

  if (meta.tenantId !== tenantId) {
    throw new NotFoundError('Leitura da planilha não encontrada.');
  }

  const age = Date.now() - new Date(meta.createdAt).getTime();
  if (age > PARSE_TTL_MS) {
    void deleteSheetParse(tenantId, parseId);
    throw new NotFoundError('Leitura da planilha expirou. Envie o arquivo novamente.');
  }

  return meta;
}

/** Lê amostra das primeiras N linhas do JSONL. */
export async function readSheetParseSample(
  tenantId: string,
  parseId: string,
  limit = 50,
): Promise<Record<string, string>[]> {
  const filePath = dataPath(tenantId, parseId);
  if (!fs.existsSync(filePath)) {
    // legacy single JSON
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

/**
 * Itera o JSONL em lotes sem carregar o arquivo inteiro na RAM.
 */
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
