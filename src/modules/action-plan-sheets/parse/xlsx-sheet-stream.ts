import yauzl from 'yauzl';
import type { Readable } from 'stream';
import { ValidationError } from '@shared/errors/AppError';
import { isTrivialCellValue } from '@shared/helpers/trivial-cell';
import { MAX_XLSX_DATA_ENTRY_BYTES } from './constants';
import { cellToString } from './sheet-cells';

type ZipHandle = {
  zip: yauzl.ZipFile;
  entries: Map<string, yauzl.Entry>;
};

type SheetRef = {
  name: string;
  path: string;
};

export type XlsxPhysicalRow = {
  line: number;
  values: string[];
  sheetName: string;
};

const SI_OPEN = /<(?:[\w.]+:)?si[\s>/]/;
const SI_CLOSE = /<\/(?:[\w.]+:)?si>/;
const T_RE = /<(?:[\w.]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?t>/g;
const V_RE = /<(?:[\w.]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?v>/;
const RPH_RE = /<(?:[\w.]+:)?rPh\b[\s\S]*?<\/(?:[\w.]+:)?rPh>/gi;
const CELL_RE =
  /<(?:[\w.]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[\w.]+:)?c>|<(?:[\w.]+:)?c\b([^>]*)\/>/g;
const SHEET_DATA_OPEN = /<(?:[\w.]+:)?sheetData[\s>]/;
const SHEET_DATA_CLOSE = /<\/(?:[\w.]+:)?sheetData>/;
const ROW_OPEN = /<(?:[\w.]+:)?row[\s>/]/;
const ROW_SELF_CLOSE = /^<(?:[\w.]+:)?row\b[^>]*\/>/;
const ROW_CLOSE = /<\/(?:[\w.]+:)?row>/;
const COVER_SHEET_NAME = /capa|cover|índice|indice|sumário|sumario|instru/i;
const DATA_SHEET_NAME = /dados|registros|planilha|pgr|a[cç][oõ]es|itens|lista/i;
const PEEK_SCORE_ROWS = 40;
const MAX_SHEETS_TO_SCORE = 12;

function decodeXml(value: string, trim = true): string {
  const decoded = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return trim ? decoded.trim() : decoded;
}

function colIndexFromRef(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(n - 1, 0);
}

function findEntry(entries: Map<string, yauzl.Entry>, test: (name: string) => boolean): string | null {
  return [...entries.keys()].find(test) ?? null;
}

function resolveEntryName(entries: Map<string, yauzl.Entry>, name: string): string | null {
  if (entries.has(name)) return name;
  const lower = name.toLowerCase();
  return [...entries.keys()].find((n) => n.toLowerCase() === lower) ?? null;
}

function openZip(filePath: string): Promise<ZipHandle> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new ValidationError('Arquivo xlsx inválido ou corrompido.'));
        return;
      }
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (entry: yauzl.Entry) => {
        entries.set(entry.fileName.replace(/\\/g, '/'), entry);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries }));
      zip.on('error', () => {
        reject(new ValidationError('Arquivo xlsx inválido ou corrompido.'));
      });
      zip.readEntry();
    });
  });
}

function openEntry(handle: ZipHandle, name: string): Promise<Readable> {
  const resolved = resolveEntryName(handle.entries, name);
  const entry = resolved ? handle.entries.get(resolved) : undefined;
  if (!entry) return Promise.reject(new ValidationError('Aba de dados ausente no xlsx.'));
  return new Promise((resolve, reject) => {
    handle.zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new ValidationError(name));
      else resolve(stream);
    });
  });
}

async function readEntryText(handle: ZipHandle, name: string, maxBytes: number): Promise<string> {
  const stream = await openEntry(handle, name);
  let out = '';
  let seen = 0;
  try {
    for await (const chunk of stream) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      seen += text.length;
      if (seen > maxBytes) {
        out += text.slice(0, Math.max(0, maxBytes - (seen - text.length)));
        break;
      }
      out += text;
    }
  } finally {
    stream.destroy();
  }
  return out;
}

function resolveWorksheetPath(target: string): string {
  let t = target.replace(/\\/g, '/').replace(/^\//, '');
  if (t.startsWith('xl/')) return t;
  const worksheetsAt = t.lastIndexOf('worksheets/');
  if (worksheetsAt >= 0) return `xl/${t.slice(worksheetsAt)}`;
  return `xl/${t.replace(/^\.\//, '')}`;
}

function fallbackSheetPaths(entries: Map<string, yauzl.Entry>): string[] {
  return [...entries.keys()]
    .filter((n) => /xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)/i)?.[1] ?? 0);
      return na - nb;
    });
}

function attr(attrs: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    attrs.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`))?.[1] ??
    attrs.match(new RegExp(`(?:^|\\s)[\\w.]+:${escaped}="([^"]*)"`))?.[1] ??
    ''
  );
}

async function listWorksheets(handle: ZipHandle): Promise<SheetRef[]> {
  const fallback = fallbackSheetPaths(handle.entries).map((path, index) => ({
    name: `Planilha ${index + 1}`,
    path,
  }));
  const wbName = findEntry(handle.entries, (n) => /xl\/workbook\.xml$/i.test(n));
  if (!wbName) return fallback;

  const wbXml = await readEntryText(handle, wbName, 2_000_000);
  const sheets = [...wbXml.matchAll(/<(?:[\w.]+:)?sheet\b([^>]*)\/?>/g)].map((m) => {
    const attrs = m[1].replace(/\/\s*$/, '');
    const name = decodeXml(attr(attrs, 'name') || 'Planilha');
    const rId = attrs.match(/\br:id="([^"]+)"/)?.[1] ?? attr(attrs, 'id');
    return { name, rId };
  });

  const relsName = findEntry(handle.entries, (n) => /xl\/_rels\/workbook\.xml\.rels$/i.test(n));
  const rels = new Map<string, string>();
  if (relsName) {
    const relsXml = await readEntryText(handle, relsName, 1_000_000);
    for (const m of relsXml.matchAll(/<(?:[\w.]+:)?Relationship\b([^>]*)\/?>/g)) {
      const attrs = m[1].replace(/\/\s*$/, '');
      const id = attr(attrs, 'Id');
      const target = attr(attrs, 'Target');
      if (id && target) rels.set(id, resolveWorksheetPath(target));
    }
  }

  const resolved: SheetRef[] = [];
  for (const sheet of sheets) {
    const path = (sheet.rId && rels.get(sheet.rId)) || null;
    const entry = path ? resolveEntryName(handle.entries, path) : null;
    if (entry) resolved.push({ name: sheet.name, path: entry });
  }
  return resolved.length ? resolved : fallback;
}

function siText(xml: string): string {
  RPH_RE.lastIndex = 0;
  T_RE.lastIndex = 0;
  const cleaned = xml.replace(RPH_RE, '');
  const parts = [...cleaned.matchAll(T_RE)].map((m) => decodeXml(m[1], false));
  return parts.join('').trim();
}

function takeCompleteSiItems(buf: string): { items: string[]; rest: string } {
  const items: string[] = [];
  let cursor = buf;
  while (true) {
    const start = cursor.search(SI_OPEN);
    if (start < 0) {
      return { items, rest: cursor.length > 2_000_000 ? cursor.slice(-256) : cursor };
    }
    const fromSi = cursor.slice(start);
    const close = fromSi.match(SI_CLOSE);
    if (!close || close.index == null) {
      return { items, rest: fromSi };
    }
    const end = close.index + close[0].length;
    items.push(siText(fromSi.slice(0, end)));
    cursor = fromSi.slice(end);
  }
}

/** Parse de `xl/sharedStrings.xml` (com ou sem prefixo de namespace). */
export function parseSharedStringItems(xml: string): string[] {
  return takeCompleteSiItems(xml).items;
}

async function parseSharedStringsStream(stream: Readable): Promise<string[]> {
  const out: string[] = [];
  let buf = '';
  let seen = 0;

  for await (const chunk of stream) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    seen += text.length;
    if (seen > MAX_XLSX_DATA_ENTRY_BYTES) {
      throw new ValidationError('Textos da planilha excedem o limite de leitura em stream.');
    }
    buf += text;
    const next = takeCompleteSiItems(buf);
    out.push(...next.items);
    buf = next.rest;
  }
  out.push(...takeCompleteSiItems(buf).items);
  return out;
}

function cellValue(cellXml: string, shared: string[]): string {
  const type = cellXml.match(/\bt=["']([^"']+)["']/)?.[1] ?? '';
  if (type === 'inlineStr') {
    T_RE.lastIndex = 0;
    const parts = [...cellXml.matchAll(T_RE)].map((m) => decodeXml(m[1]));
    return parts.join('');
  }
  const v = cellXml.match(V_RE)?.[1];
  if (v == null) return '';
  const decoded = decodeXml(v);
  if (type === 's') {
    const idx = Number(decoded);
    if (!Number.isInteger(idx) || idx < 0) return '';
    return shared[idx] ?? '';
  }
  if (type === 'b') return decoded === '1' ? 'TRUE' : 'FALSE';
  if (type === 'e') return decoded;
  return cellToString(/^-?\d+(\.\d+)?$/.test(decoded) ? Number(decoded) : decoded);
}

function parseRow(rowXml: string, shared: string[]): { line: number; values: string[] } {
  const line = Number(rowXml.match(/\br="(\d+)"/)?.[1] ?? '0');
  const values: string[] = [];
  CELL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let maxIndex = -1;
  while ((match = CELL_RE.exec(rowXml))) {
    const attrs = match[1] ?? match[3] ?? '';
    const inner = match[2] ?? '';
    const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? '';
    const index = colIndexFromRef(ref);
    while (values.length <= index) values.push('');
    values[index] = cellValue(`<c ${attrs}>${inner}</c>`, shared);
    if (index > maxIndex) maxIndex = index;
  }
  return { line, values: maxIndex >= 0 ? values.slice(0, maxIndex + 1) : values };
}

async function* iterateSheetRows(
  stream: Readable,
  shared: string[],
): AsyncGenerator<{ line: number; values: string[] }> {
  let buf = '';
  let inSheetData = false;
  let done = false;
  let seen = 0;

  const consume = function* (): Generator<{ line: number; values: string[] }> {
    while (!done) {
      if (!inSheetData) {
        const start = buf.search(SHEET_DATA_OPEN);
        if (start < 0) {
          if (buf.length > 2_000_000) buf = buf.slice(-256);
          return;
        }
        inSheetData = true;
        buf = buf.slice(start);
      }
      const endMatch = buf.match(SHEET_DATA_CLOSE);
      const endData = endMatch?.index ?? -1;
      const search = endData >= 0 ? buf.slice(0, endData) : buf;
      const rowStart = search.search(ROW_OPEN);
      if (rowStart < 0) {
        if (endData >= 0) {
          done = true;
          buf = '';
        } else if (buf.length > 8_000_000) {
          buf = buf.slice(-1024);
        }
        return;
      }
      const fromRow = search.slice(rowStart);
      const selfClose = fromRow.match(ROW_SELF_CLOSE);
      if (selfClose) {
        const xml = selfClose[0];
        buf = search.slice(rowStart + xml.length) + (endData >= 0 ? buf.slice(endData) : '');
        yield parseRow(xml, shared);
        continue;
      }
      const close = fromRow.match(ROW_CLOSE);
      if (!close || close.index == null) {
        buf = search.slice(rowStart) + (endData >= 0 ? buf.slice(endData) : '');
        return;
      }
      const xml = fromRow.slice(0, close.index + close[0].length);
      buf = search.slice(rowStart + xml.length) + (endData >= 0 ? buf.slice(endData) : '');
      yield parseRow(xml, shared);
    }
  };

  for await (const chunk of stream) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    seen += text.length;
    if (seen > MAX_XLSX_DATA_ENTRY_BYTES) {
      throw new ValidationError('Aba de dados excede o limite de leitura em stream.');
    }
    buf += text;
    yield* consume();
    if (done) break;
  }
  yield* consume();
}

function scorePeekedRows(rows: Array<{ values: string[] }>, sheetName: string): number {
  let score = 0;
  for (const row of rows) {
    for (const cell of row.values) {
      if (isTrivialCellValue(cell)) continue;
      score += 1;
      const t = cell.trim();
      if (/[A-Za-zÀ-ÿ]/.test(t)) score += 2;
      if (t.length > 12) score += 1;
    }
  }
  if (COVER_SHEET_NAME.test(sheetName)) score = Math.floor(score * 0.2);
  if (DATA_SHEET_NAME.test(sheetName)) score += 40;
  return score;
}

async function peekSheetRows(
  handle: ZipHandle,
  path: string,
  shared: string[],
): Promise<Array<{ values: string[] }>> {
  const stream = await openEntry(handle, path);
  const rows: Array<{ values: string[] }> = [];
  try {
    for await (const row of iterateSheetRows(stream, shared)) {
      if (row.line <= 0) continue;
      rows.push({ values: row.values });
      if (rows.length >= PEEK_SCORE_ROWS) break;
    }
  } finally {
    stream.destroy();
  }
  return rows;
}

async function pickWorksheet(handle: ZipHandle, shared: string[]): Promise<SheetRef> {
  const sheets = await listWorksheets(handle);
  if (!sheets.length) throw new ValidationError('Nenhuma aba de dados encontrada no xlsx.');
  if (sheets.length === 1) return sheets[0];

  const toScore = sheets.slice(0, MAX_SHEETS_TO_SCORE);
  let best = toScore[0];
  let bestScore = -1;
  for (const sheet of toScore) {
    const peeked = await peekSheetRows(handle, sheet.path, shared);
    const score = scorePeekedRows(peeked, sheet.name);
    if (score > bestScore) {
      bestScore = score;
      best = sheet;
    }
  }
  return best;
}

async function loadSharedStrings(handle: ZipHandle): Promise<string[]> {
  const sharedName = findEntry(handle.entries, (n) => /sharedstrings\.xml$/i.test(n));
  if (!sharedName) return [];
  const stream = await openEntry(handle, sharedName);
  try {
    return await parseSharedStringsStream(stream);
  } finally {
    stream.destroy();
  }
}

/** Streama a aba de dados (não assume sheet1) + sharedStrings. */
export async function* iterateXlsxDataRows(filePath: string): AsyncGenerator<XlsxPhysicalRow> {
  const handle = await openZip(filePath);
  try {
    const shared = await loadSharedStrings(handle);
    const sheet = await pickWorksheet(handle, shared);
    const sheetStream = await openEntry(handle, sheet.path);
    try {
      for await (const row of iterateSheetRows(sheetStream, shared)) {
        if (row.line <= 0) continue;
        yield { line: row.line, values: row.values, sheetName: sheet.name };
      }
    } finally {
      sheetStream.destroy();
    }
  } finally {
    handle.zip.close();
  }
}

/** @deprecated use iterateXlsxDataRows */
export const iterateXlsxSheet1Rows = iterateXlsxDataRows;
