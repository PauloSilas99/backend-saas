import fs from 'fs';
import path from 'path';
import readline from 'readline';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { ValidationError } from '@shared/errors/AppError';
import { MAX_IMPORT_ROWS, MAX_TRAILING_EMPTY_ROWS } from './imports.constants';
import {
  cellToString,
  detectHeaderRowIndex,
  padRow,
  rowHasData,
} from './sheet-cells';

export const PEEK_PHYSICAL_ROWS = 20;

export type ParsedSpreadsheet = {
  headers: string[];
  rows: Array<{ lineNumber: number; rawData: Record<string, string> }>;
};

export type SpreadsheetStreamHandlers = {
  onHeaders: (headers: string[]) => void;
  /** `dense` é a linha por índice de coluna (A=0, B=1…), inclusive células vazias. */
  onRow: (
    row: Record<string, string>,
    lineNumber: number,
    dense: string[],
  ) => void | Promise<void>;
};

export type SpreadsheetStreamOptions = {
  /** Linha 1-based do cabeçalho no arquivo. */
  headerRowIndex?: number;
  /** Quantidade de colunas confirmada (A..N). */
  columnCount?: number;
};

export type SpreadsheetStreamResult = {
  headers: string[];
  totalRows: number;
  truncated: boolean;
};

export type SpreadsheetPeekRow = {
  line: number;
  values: string[];
};

export type SpreadsheetPeek = {
  sheetName: string;
  rows: SpreadsheetPeekRow[];
  suggestedHeaderRow: number;
  columnCount: number;
};

function normalizeHeader(value: string): string {
  return String(value ?? '').trim();
}

export function uniquifyHeaderNames(rawHeaders: string[]): string[] {
  const headers: string[] = [];
  const seen = new Map<string, number>();

  rawHeaders.forEach((cell, index) => {
    const label = normalizeHeader(cell) || `Coluna ${index + 1}`;
    let unique = label;
    let n = 2;
    while (seen.has(unique)) {
      unique = `${label} (${n})`;
      n += 1;
    }
    headers.push(unique);
    seen.set(unique, 1);
  });

  return headers;
}

/** Ignora células vazias à direita do último cabeçalho real. */
export function headersFromRow(values: string[]): string[] {
  let last = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (normalizeHeader(values[i])) last = i;
  }
  if (last < 0) return [];
  return uniquifyHeaderNames(values.slice(0, last + 1));
}

function rowFromValues(headers: string[], values: string[]): Record<string, string> | null {
  const padded = padRow(values, headers.length);
  const rawData: Record<string, string> = {};
  let hasData = false;
  headers.forEach((header, index) => {
    const value = padded[index] ?? '';
    rawData[header] = value;
    if (value) hasData = true;
  });
  return hasData ? rawData : null;
}

function denseExcelRow(row: ExcelJS.Row, columnCount: number): string[] {
  const sparse = Array.isArray(row.values) ? (row.values as unknown[]) : [];
  const width = Math.max(columnCount, row.cellCount || 0, Math.max(sparse.length - 1, 0), 1);
  const values: string[] = [];
  for (let col = 1; col <= width; col += 1) {
    let raw: unknown;
    if (typeof row.getCell === 'function') {
      try {
        raw = row.getCell(col).value;
      } catch {
        raw = sparse[col];
      }
    } else {
      raw = sparse[col];
    }
    values.push(cellToString(raw));
  }
  return columnCount > 0 ? padRow(values, columnCount) : values;
}

/** Monta registros a partir da amostra (peek), com a linha de cabeçalho escolhida. */
export function recordsFromPeek(
  rows: SpreadsheetPeekRow[],
  headerRowIndex: number,
): { headers: string[]; records: Record<string, string>[] } {
  const header = rows.find((row) => row.line === headerRowIndex);
  const headers = headersFromRow(header?.values ?? []);
  const records: Record<string, string>[] = [];
  for (const row of rows) {
    if (row.line <= headerRowIndex) continue;
    const rawData = rowFromValues(headers, row.values);
    if (rawData) records.push(rawData);
  }
  return { headers, records };
}

function parseCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function detectCsvDelimiter(line: string): string {
  const commas = (line.match(/,/g) ?? []).length;
  const semis = (line.match(/;/g) ?? []).length;
  const tabs = (line.match(/\t/g) ?? []).length;
  if (semis > commas && semis >= tabs) return ';';
  if (tabs > commas && tabs >= semis) return '\t';
  return ',';
}

function finalizePeek(sheetName: string, rows: SpreadsheetPeekRow[]): SpreadsheetPeek {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.values.length), 0);
  const padded = rows.map((row) => ({
    line: row.line,
    values: padRow(row.values, columnCount),
  }));
  const suggestedIndex = detectHeaderRowIndex(padded.map((row) => row.values));
  return {
    sheetName,
    rows: padded,
    suggestedHeaderRow: padded[suggestedIndex]?.line ?? 1,
    columnCount,
  };
}

/**
 * Lê só o começo do arquivo (cabeçalhos candidatos + exemplos).
 * Não percorre o restante das linhas.
 */
export async function peekSpreadsheetFile(filePath: string): Promise<SpreadsheetPeek> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') return peekCsv(filePath);
  if (ext === '.xlsx') return peekXlsx(filePath);
  return peekWithSheetJs(filePath);
}

async function peekXlsx(filePath: string): Promise<SpreadsheetPeek> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });

  try {
    for await (const worksheetReader of workbookReader) {
      const rows: SpreadsheetPeekRow[] = [];
      let line = 0;
      for await (const row of worksheetReader) {
        line += 1;
        rows.push({ line, values: denseExcelRow(row, 0) });
        if (rows.length >= PEEK_PHYSICAL_ROWS) break;
      }
      const worksheetName = (worksheetReader as unknown as { name?: string }).name;
      const name = typeof worksheetName === 'string' ? worksheetName : 'Planilha 1';
      if (rows.length === 0) throw new ValidationError('Planilha vazia');
      return finalizePeek(name, rows);
    }

    throw new ValidationError('Planilha vazia');
  } finally {
    const stream = (workbookReader as { stream?: { destroy?: () => void } }).stream;
    stream?.destroy?.();
  }
}

async function peekCsv(filePath: string): Promise<SpreadsheetPeek> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: SpreadsheetPeekRow[] = [];
  let line = 0;
  let delimiter = ',';

  for await (const rawLine of rl) {
    let text = rawLine;
    if (line === 0 && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    line += 1;
    if (line === 1) delimiter = detectCsvDelimiter(text);
    rows.push({ line, values: parseCsvLine(text, delimiter) });
    if (rows.length >= PEEK_PHYSICAL_ROWS) break;
  }
  rl.close();
  stream.destroy();
  if (rows.length === 0) throw new ValidationError('Planilha vazia');
  return finalizePeek('Planilha 1', rows);
}

async function peekWithSheetJs(filePath: string): Promise<SpreadsheetPeek> {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new ValidationError('Planilha vazia');
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: false,
  });
  const rows: SpreadsheetPeekRow[] = matrix.slice(0, PEEK_PHYSICAL_ROWS).map((line, index) => ({
    line: index + 1,
    values: (line ?? []).map((cell) => cellToString(cell)),
  }));
  if (rows.length === 0) throw new ValidationError('Planilha vazia');
  return finalizePeek(sheetName, rows);
}

/**
 * Lê a primeira aba em stream (xlsx/csv) ou em lote (.xls).
 * Células são lidas por índice de coluna (A, B, C…), não por array esparso.
 */
export async function streamSpreadsheetFile(
  filePath: string,
  handlers: SpreadsheetStreamHandlers,
  options: SpreadsheetStreamOptions = {},
): Promise<SpreadsheetStreamResult> {
  const ext = path.extname(filePath).toLowerCase();
  const headerRowIndex = options.headerRowIndex && options.headerRowIndex > 0 ? options.headerRowIndex : 1;

  if (ext === '.csv') {
    return streamCsv(filePath, handlers, headerRowIndex, options.columnCount);
  }
  if (ext === '.xlsx') {
    return streamXlsx(filePath, handlers, headerRowIndex, options.columnCount);
  }
  return streamWithSheetJs(filePath, handlers, headerRowIndex, options.columnCount);
}

/** Compatível com o módulo legado /imports (materializa as linhas). */
export async function parseSpreadsheetFile(filePath: string): Promise<ParsedSpreadsheet> {
  const rows: ParsedSpreadsheet['rows'] = [];
  let headers: string[] = [];

  const result = await streamSpreadsheetFile(filePath, {
    onHeaders: (next) => {
      headers = next;
    },
    onRow: (rawData, lineNumber) => {
      rows.push({ lineNumber, rawData });
    },
  });

  return { headers: result.headers.length ? result.headers : headers, rows };
}

async function streamXlsx(
  filePath: string,
  handlers: SpreadsheetStreamHandlers,
  headerRowIndex: number,
  columnCountHint?: number,
): Promise<SpreadsheetStreamResult> {
  try {
    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      entries: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      worksheets: 'emit',
    });

    for await (const worksheetReader of workbookReader) {
      let headers: string[] = [];
      let columnCount = columnCountHint ?? 0;
      let lineNumber = 0;
      let totalRows = 0;
      let emptyStreak = 0;
      let truncated = false;

      for await (const row of worksheetReader) {
        lineNumber += 1;
        if (lineNumber < headerRowIndex) continue;

        const values = denseExcelRow(row, columnCount);

        if (lineNumber === headerRowIndex) {
          headers = headersFromRow(values);
          if (headers.length === 0 || !headers.some((h) => h.trim())) {
            throw new ValidationError('Cabeçalho vazio ou inválido');
          }
          columnCount = headers.length;
          handlers.onHeaders(headers);
          continue;
        }

        const rawData = rowFromValues(headers, values);
        if (rawData) {
          if (totalRows >= MAX_IMPORT_ROWS) {
            truncated = true;
            break;
          }
          emptyStreak = 0;
          totalRows += 1;
          await handlers.onRow(rawData, lineNumber, padRow(values, columnCount));
        } else if (totalRows > 0) {
          emptyStreak += 1;
          if (emptyStreak >= MAX_TRAILING_EMPTY_ROWS) break;
        }
      }

      if (headers.length === 0) {
        throw new ValidationError('Cabeçalho vazio ou inválido');
      }
      if (totalRows === 0) {
        throw new ValidationError('Planilha sem linhas de dados além do cabeçalho');
      }

      return { headers, totalRows, truncated };
    }

    throw new ValidationError('Planilha vazia');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Arquivo xlsx corrompido ou ilegível');
  }
}

async function streamCsv(
  filePath: string,
  handlers: SpreadsheetStreamHandlers,
  headerRowIndex: number,
  columnCountHint?: number,
): Promise<SpreadsheetStreamResult> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers: string[] = [];
  let columnCount = columnCountHint ?? 0;
  let lineNumber = 0;
  let totalRows = 0;
  let delimiter = ',';
  let truncated = false;
  let emptyStreak = 0;

  for await (const rawLine of rl) {
    let line = rawLine;
    if (lineNumber === 0 && line.charCodeAt(0) === 0xfeff) {
      line = line.slice(1);
    }
    lineNumber += 1;
    if (lineNumber === 1) delimiter = detectCsvDelimiter(line);
    if (lineNumber < headerRowIndex) continue;

    const values = parseCsvLine(line, delimiter);

    if (lineNumber === headerRowIndex) {
      headers = headersFromRow(values);
      if (headers.length === 0 || !headers.some((h) => h.trim())) {
        throw new ValidationError('Cabeçalho vazio ou inválido');
      }
      columnCount = headers.length;
      handlers.onHeaders(headers);
      continue;
    }

    const rawData = rowFromValues(headers, columnCount ? padRow(values, columnCount) : values);
    if (!rawData) {
      if (totalRows > 0) {
        emptyStreak += 1;
        if (emptyStreak >= MAX_TRAILING_EMPTY_ROWS) break;
      }
      continue;
    }
    emptyStreak = 0;
    if (totalRows >= MAX_IMPORT_ROWS) {
      truncated = true;
      break;
    }
    totalRows += 1;
    await handlers.onRow(rawData, lineNumber, padRow(values, columnCount));
  }

  if (headers.length === 0) {
    throw new ValidationError('Cabeçalho vazio ou inválido');
  }
  if (totalRows === 0) {
    throw new ValidationError('Planilha sem linhas de dados além do cabeçalho');
  }

  return { headers, totalRows, truncated };
}

async function streamWithSheetJs(
  filePath: string,
  handlers: SpreadsheetStreamHandlers,
  headerRowIndex: number,
  columnCountHint?: number,
): Promise<SpreadsheetStreamResult> {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ValidationError('Planilha vazia');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: false,
  });

  if (matrix.length < headerRowIndex) {
    throw new ValidationError('Cabeçalho vazio ou inválido');
  }

  const headerValues = (matrix[headerRowIndex - 1] ?? []).map((cell) => cellToString(cell));
  const headers = headersFromRow(headerValues);
  if (headers.length === 0) {
    throw new ValidationError('Cabeçalho vazio ou inválido');
  }
  const columnCount = columnCountHint ?? headers.length;
  handlers.onHeaders(headers);

  let totalRows = 0;
  let truncated = false;
  let emptyStreak = 0;
  for (let i = headerRowIndex; i < matrix.length; i += 1) {
    const values = padRow(
      (matrix[i] ?? []).map((cell) => cellToString(cell)),
      columnCount,
    );
    const rawData = rowFromValues(headers, values);
    if (!rawData) {
      if (totalRows > 0) {
        emptyStreak += 1;
        if (emptyStreak >= MAX_TRAILING_EMPTY_ROWS) break;
      }
      continue;
    }
    emptyStreak = 0;
    if (totalRows >= MAX_IMPORT_ROWS) {
      truncated = true;
      break;
    }
    totalRows += 1;
    await handlers.onRow(rawData, i + 1, values);
  }

  if (totalRows === 0) {
    throw new ValidationError('Planilha sem linhas de dados além do cabeçalho');
  }

  return { headers, totalRows, truncated };
}

export { detectHeaderRowIndex, rowHasData };
