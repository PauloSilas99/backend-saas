import yauzl from 'yauzl';
import type { Readable } from 'stream';
import { MAX_IMPORT_ROWS, MAX_TRAILING_EMPTY_ROWS } from '../src/modules/action-plan-sheets/parse/constants';
import { cellToString, padRow } from '../src/modules/action-plan-sheets/parse/sheet-cells';
import {
  headersFromRow,
  type SpreadsheetStreamHandlers,
  type SpreadsheetStreamResult,
} from '../src/modules/action-plan-sheets/parse/spreadsheet';

type ZipHandle = {
  zip: yauzl.ZipFile;
  entries: Map<string, yauzl.Entry>;
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function isMeaningfulCell(header: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^coluna \d+$/i.test(header) && /^(0+|false|#ref!|#n\/a|#value!)$/i.test(trimmed)) {
    return false;
  }
  return true;
}

function colIndexFromRef(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(n - 1, 0);
}

function openZip(filePath: string): Promise<ZipHandle> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('zip inválido'));
        return;
      }
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (entry: yauzl.Entry) => {
        entries.set(entry.fileName.replace(/\\/g, '/'), entry);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries }));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

function openEntry(handle: ZipHandle, name: string): Promise<Readable> {
  const entry = handle.entries.get(name);
  if (!entry) return Promise.reject(new Error(`Entrada ausente: ${name}`));
  return new Promise((resolve, reject) => {
    handle.zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(name));
      else resolve(stream);
    });
  });
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRe.exec(xml))) {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    out.push(parts.join(''));
  }
  return out;
}

function cellValue(cellXml: string, shared: string[]): string {
  const type = cellXml.match(/\bt="([^"]+)"/)?.[1] ?? '';
  if (type === 'inlineStr') {
    const parts = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    return parts.join('');
  }
  const v = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (v == null) return '';
  const decoded = decodeXml(v);
  if (type === 's') {
    const idx = Number(decoded);
    return Number.isInteger(idx) ? shared[idx] ?? '' : '';
  }
  if (type === 'b') return decoded === '1' ? 'TRUE' : 'FALSE';
  return cellToString(/^\d+(\.\d+)?$/.test(decoded) ? Number(decoded) : decoded);
}

function parseRow(rowXml: string, shared: string[], columnCount: number): { line: number; values: string[] } {
  const line = Number(rowXml.match(/\br="(\d+)"/)?.[1] ?? '0');
  const width = Math.max(columnCount, 1);
  const values = Array.from({ length: width }, () => '');
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  let maxIndex = width - 1;
  while ((match = cellRe.exec(rowXml))) {
    const attrs = match[1] ?? match[3] ?? '';
    const inner = match[2] ?? '';
    const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? '';
    const index = colIndexFromRef(ref);
    if (index >= values.length) {
      while (values.length <= index) values.push('');
      maxIndex = index;
    }
    values[index] = cellValue(`<c ${attrs}>${inner}</c>`, shared);
  }
  return { line, values: columnCount > 0 ? padRow(values, columnCount) : values.slice(0, maxIndex + 1) };
}

async function* iterateRows(stream: Readable, shared: string[], columnCountHint: number) {
  let buf = '';
  let inSheetData = false;
  let done = false;

  const consume = function* (): Generator<{ line: number; values: string[] }> {
    while (!done) {
      if (!inSheetData) {
        const start = buf.search(/<sheetData[\s>]/);
        if (start < 0) {
          if (buf.length > 2_000_000) buf = buf.slice(-256);
          return;
        }
        inSheetData = true;
        buf = buf.slice(start);
      }
      const endData = buf.indexOf('</sheetData>');
      const search = endData >= 0 ? buf.slice(0, endData) : buf;
      const rowStart = search.search(/<row[\s>]/);
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
      const selfClose = fromRow.match(/^<row\b[^>]*\/>/);
      const closeAt = fromRow.indexOf('</row>');
      if (selfClose) {
        const xml = selfClose[0];
        buf = search.slice(rowStart + xml.length) + (endData >= 0 ? buf.slice(endData) : '');
        yield parseRow(xml, shared, columnCountHint);
        continue;
      }
      if (closeAt < 0) {
        buf = search.slice(rowStart) + (endData >= 0 ? buf.slice(endData) : '');
        return;
      }
      const xml = fromRow.slice(0, closeAt + 6);
      buf = search.slice(rowStart + xml.length) + (endData >= 0 ? buf.slice(endData) : '');
      yield parseRow(xml, shared, columnCountHint);
    }
  };

  for await (const chunk of stream) {
    buf += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    yield* consume();
    if (done) break;
  }
  yield* consume();
}

export async function streamXlsxZipFile(
  filePath: string,
  handlers: SpreadsheetStreamHandlers,
  options: { headerRowIndex?: number; columnCount?: number } = {},
): Promise<SpreadsheetStreamResult> {
  const headerRowIndex = options.headerRowIndex && options.headerRowIndex > 0 ? options.headerRowIndex : 1;
  const handle = await openZip(filePath);
  try {
    const sharedName = [...handle.entries.keys()].find((n) => n.endsWith('xl/sharedStrings.xml'));
    const sheetName = [...handle.entries.keys()].find((n) => /xl\/worksheets\/sheet1\.xml$/i.test(n));
    if (!sheetName) throw new Error('Aba sheet1.xml ausente');

    const shared = sharedName ? parseSharedStrings(await readAll(await openEntry(handle, sharedName))) : [];
    const sheetStream = await openEntry(handle, sheetName);

    let headers: string[] = [];
    let columnCount = options.columnCount ?? 0;
    let headerOffset = 0;
    let totalRows = 0;
    let emptyStreak = 0;
    let truncated = false;
    let pastHeader = false;

    for await (const row of iterateRows(sheetStream, shared, columnCount)) {
      if (row.line < headerRowIndex) continue;
      if (row.line === headerRowIndex) {
        const rawHeaders = headersFromRow(row.values);
        while (headerOffset < rawHeaders.length && /^Coluna \d+$/i.test(rawHeaders[headerOffset])) {
          headerOffset += 1;
        }
        headers = rawHeaders.slice(headerOffset);
        if (headers.length === 0 || !headers.some((h) => h.trim())) {
          throw new Error('Cabeçalho vazio ou inválido');
        }
        columnCount = rawHeaders.length;
        handlers.onHeaders(headers);
        pastHeader = true;
        continue;
      }
      if (!pastHeader) continue;

      const values = padRow(row.values, columnCount).slice(headerOffset);
      const rawData: Record<string, string> = {};
      let hasData = false;
      headers.forEach((header, index) => {
        const value = values[index] ?? '';
        rawData[header] = value;
        if (isMeaningfulCell(header, value)) hasData = true;
      });

      if (!hasData) {
        if (totalRows > 0) {
          emptyStreak += 1;
          if (emptyStreak >= MAX_TRAILING_EMPTY_ROWS) break;
        }
        continue;
      }

      if (totalRows >= MAX_IMPORT_ROWS) {
        truncated = true;
        break;
      }
      emptyStreak = 0;
      totalRows += 1;
      await handlers.onRow(rawData, row.line, values);
    }

    sheetStream.destroy();
    if (headers.length === 0) throw new Error('Cabeçalho vazio ou inválido');
    if (totalRows === 0) throw new Error('Planilha sem linhas de dados além do cabeçalho');
    return { headers, totalRows, truncated };
  } finally {
    handle.zip.close();
  }
}
