import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { ValidationError } from '@shared/errors/AppError';
import { MAX_IMPORT_ROWS } from './imports.constants';

export type ParsedSpreadsheet = {
  headers: string[];
  rows: Array<{ lineNumber: number; rawData: Record<string, string> }>;
};

function normalizeHeader(value: string): string {
  return String(value ?? '').trim();
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && value.text) return String(value.text).trim();
    if ('result' in value && value.result !== undefined && value.result !== null) {
      return String(value.result).trim();
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

export async function parseSpreadsheetFile(filePath: string): Promise<ParsedSpreadsheet> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    return parseCsvWithExcelJs(filePath);
  }

  if (ext === '.xlsx') {
    return parseXlsxStreaming(filePath);
  }

  return parseWithSheetJs(filePath);
}

async function parseCsvWithExcelJs(filePath: string): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.csv.read(fs.createReadStream(filePath));
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ValidationError('Planilha vazia');
  }
  return extractFromWorksheet(sheet);
}

async function parseXlsxStreaming(filePath: string): Promise<ParsedSpreadsheet> {
  try {
    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
      entries: 'emit',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
      styles: 'ignore',
      worksheets: 'emit',
    });

    for await (const worksheetReader of workbookReader) {
      const rows: ParsedSpreadsheet['rows'] = [];
      let headers: string[] = [];
      let lineNumber = 1;

      for await (const row of worksheetReader) {
        const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellToString);

        if (lineNumber === 1) {
          headers = values.map(normalizeHeader).filter((h) => h.length > 0);
          if (headers.length === 0) {
            throw new ValidationError('Cabeçalho vazio ou inválido');
          }
        } else {
          const rawData: Record<string, string> = {};
          let hasData = false;
          headers.forEach((header, index) => {
            const value = values[index] ?? '';
            rawData[header] = value;
            if (value) hasData = true;
          });
          if (hasData) {
            rows.push({ lineNumber, rawData });
          }
        }

        lineNumber += 1;
        if (rows.length > MAX_IMPORT_ROWS) {
          throw new ValidationError(`Planilha excede o limite de ${MAX_IMPORT_ROWS} linhas.`);
        }
      }

      if (rows.length === 0) {
        throw new ValidationError('Planilha sem linhas de dados além do cabeçalho');
      }

      return { headers, rows };
    }

    throw new ValidationError('Planilha vazia');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Arquivo xlsx corrompido ou ilegível');
  }
}

function extractFromWorksheet(sheet: ExcelJS.Worksheet): ParsedSpreadsheet {
  const rows: ParsedSpreadsheet['rows'] = [];
  let headers: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellToString);

    if (rowNumber === 1) {
      headers = values.map(normalizeHeader).filter((h) => h.length > 0);
      if (headers.length === 0) {
        throw new ValidationError('Cabeçalho vazio ou inválido');
      }
      return;
    }

    const rawData: Record<string, string> = {};
    let hasData = false;
    headers.forEach((header, index) => {
      const value = values[index] ?? '';
      rawData[header] = value;
      if (value) hasData = true;
    });

    if (hasData) {
      rows.push({ lineNumber: rowNumber, rawData });
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      throw new ValidationError(`Planilha excede o limite de ${MAX_IMPORT_ROWS} linhas.`);
    }
  });

  if (rows.length === 0) {
    throw new ValidationError('Planilha sem linhas de dados além do cabeçalho');
  }

  return { headers, rows };
}

function parseWithSheetJs(filePath: string): ParsedSpreadsheet {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ValidationError('Planilha vazia');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as string[][];

  if (matrix.length < 2) {
    throw new ValidationError('Planilha sem linhas de dados além do cabeçalho');
  }

  const headers = matrix[0].map((h) => normalizeHeader(String(h))).filter((h) => h.length > 0);
  if (headers.length === 0) {
    throw new ValidationError('Cabeçalho vazio ou inválido');
  }

  const rows: ParsedSpreadsheet['rows'] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const values = matrix[i] ?? [];
    const rawData: Record<string, string> = {};
    let hasData = false;

    headers.forEach((header, index) => {
      const value = String(values[index] ?? '').trim();
      rawData[header] = value;
      if (value) hasData = true;
    });

    if (hasData) {
      rows.push({ lineNumber: i + 1, rawData });
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      throw new ValidationError(`Planilha excede o limite de ${MAX_IMPORT_ROWS} linhas.`);
    }
  }

  if (rows.length === 0) {
    throw new ValidationError('Planilha sem linhas de dados além do cabeçalho');
  }

  return { headers, rows };
}
