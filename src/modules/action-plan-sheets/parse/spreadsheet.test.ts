import fs from 'fs';
import os from 'os';
import path from 'path';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@shared/errors/AppError';
import { assertAllowedUploadMime, assertRealFileType } from './file-validator';
import {
  parseSpreadsheetFile,
  peekSpreadsheetFile,
  recordsFromPeek,
  streamSpreadsheetFile,
  extractPhysicalRows,
} from './spreadsheet';
import { normalizeDateValue, rowHasData } from './sheet-cells';
import { parseSharedStringItems } from './xlsx-sheet-stream';

const tempFiles: string[] = [];

function writeTempFile(name: string, content: Buffer | string): string {
  const filePath = path.join(os.tmpdir(), `sheet-parse-test-${Date.now()}-${name}`);
  fs.writeFileSync(filePath, content);
  tempFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

describe('file-validator', () => {
  it('rejeita mimetype forjado quando magic bytes não correspondem', async () => {
    const filePath = writeTempFile('fake.xlsx', Buffer.from('not-a-real-xlsx-file-content'));

    await expect(assertRealFileType(filePath, 'planilha.xlsx')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('aceita csv com conteúdo textual válido', async () => {
    const filePath = writeTempFile(
      'valid.csv',
      'titulo,status,prioridade,responsavel,unidade\nA,pendente,alta,Joao,Matriz\n',
    );

    const mime = await assertRealFileType(filePath, 'valid.csv');
    expect(mime).toBe('text/csv');
  });

  it('rejeita mimetype não permitido', () => {
    expect(() => assertAllowedUploadMime('application/pdf')).toThrow(ValidationError);
  });
});

describe('spreadsheet parser', () => {
  it('falha com planilha corrompida', async () => {
    const filePath = writeTempFile('broken.xlsx', Buffer.from('PK\x03\x04corrupted'));

    await expect(parseSpreadsheetFile(filePath)).rejects.toBeInstanceOf(ValidationError);
  });

  it('faz parse de csv válido com cabeçalho e dados', async () => {
    const filePath = writeTempFile(
      'sample.csv',
      [
        'titulo,status,prioridade,responsavel,unidade,prazo',
        'Ação 1,pendente,alta,João,Matriz,2026-08-01',
      ].join('\n'),
    );

    const parsed = await parseSpreadsheetFile(filePath);
    expect(parsed.headers).toContain('titulo');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].rawData.titulo).toBe('Ação 1');
  });

  it('detecta cabeçalho abaixo do título e preserva colunas vazias no meio', async () => {
    const filePath = writeTempFile(
      'pgr-header.csv',
      [
        'PGR Unidade Norte 2026',
        '',
        'titulo,,status,prazo',
        'Ação 1,,pendente,2026-08-01',
        'Ação 2,,concluido,45396',
      ].join('\n'),
    );

    const peek = await peekSpreadsheetFile(filePath);
    expect(peek.suggestedHeaderRow).toBe(3);

    const { headers, records } = recordsFromPeek(peek.rows, peek.suggestedHeaderRow);
    expect(headers[0]).toBe('titulo');
    expect(headers[2]).toBe('status');
    expect(records[0].titulo).toBe('Ação 1');
    expect(records[0].status).toBe('pendente');
    expect(records[0][headers[1]]).toBe('');

    const denseRows: string[][] = [];
    await streamSpreadsheetFile(
      filePath,
      {
        onHeaders: () => undefined,
        onRow: (_row, _line, dense) => {
          denseRows.push(dense);
        },
      },
      { headerRowIndex: 3 },
    );

    expect(denseRows[0][0]).toBe('Ação 1');
    expect(denseRows[0][1]).toBe('');
    expect(denseRows[0][2]).toBe('pendente');
    expect(denseRows[1][3]).toBe('45396');
  });

  it('extrai linhas físicas de csv e descarta vazias no final', async () => {
    const filePath = writeTempFile(
      'extract.csv',
      ['titulo,status', 'Ação 1,pendente', 'Ação 2,concluido', '', '', ''].join('\n'),
    );

    const rows: Array<{ line: number; values: string[] }> = [];
    const result = await extractPhysicalRows(filePath, (row) => {
      rows.push(row);
    });

    expect(result.sheetName).toBe('Planilha 1');
    expect(rows.filter((r) => r.values.some((cell) => cell.trim())).map((r) => r.values[0])).toEqual([
      'titulo',
      'Ação 1',
      'Ação 2',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('lê xlsx pela aba de dados e aceita o arquivo no validador', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['titulo', 'status'],
      ['Ação 1', 'pendente'],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Dados');
    const filePath = writeTempFile(
      'mini.xlsx',
      Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array),
    );

    await expect(assertRealFileType(filePath, 'mini.xlsx')).resolves.toMatch(/spreadsheetml|zip/);

    const rows: Array<{ line: number; values: string[] }> = [];
    await extractPhysicalRows(filePath, (row) => {
      rows.push(row);
    });
    expect(rows.some((r) => r.values.includes('Ação 1'))).toBe(true);
    expect(rows.some((r) => r.values.includes('titulo'))).toBe(true);
  });

  it('escolhe a aba de dados quando a primeira é capa com zeros', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [0, 0, 0],
        [0, 0, 0],
      ]),
      'Capa',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['titulo', 'status'],
        ['Ação real', 'pendente'],
      ]),
      'Dados',
    );
    const filePath = writeTempFile(
      'capa-dados.xlsx',
      Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array),
    );

    const rows: Array<{ line: number; values: string[] }> = [];
    const result = await extractPhysicalRows(filePath, (row) => {
      rows.push(row);
    });

    expect(result.sheetName).toBe('Dados');
    expect(rows.some((r) => r.values.includes('Ação real'))).toBe(true);
    expect(rows.some((r) => r.values.includes('titulo'))).toBe(true);
  });
});

describe('sheet-cells', () => {
  it('normaliza datas BR e serial Excel sem deslocar o dia', () => {
    expect(normalizeDateValue('17/08/2026')).toEqual({ value: '2026-08-17', ok: true });
    expect(normalizeDateValue('2026-08-17T00:00:00.000Z').value).toBe('2026-08-17');
    const serial = normalizeDateValue('44927');
    expect(serial.ok).toBe(true);
    expect(serial.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('não trata linha só com 0 ou traço como dado', () => {
    expect(rowHasData(['0', '', '-'])).toBe(false);
    expect(rowHasData(['00', '0.0'])).toBe(false);
    expect(rowHasData(['Ação 1', '0'])).toBe(true);
  });
});

describe('xlsx shared strings', () => {
  it('lê itens com tags namespaced e rich text', () => {
    const xml = `<?xml version="1.0"?>
      <x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <x:si><x:t>titulo</x:t></x:si>
        <x:si><x:r><x:t>Ação</x:t></x:r><x:r><x:t> 1</x:t></x:r></x:si>
        <x:si><x:t xml:space="preserve"> pendente </x:t></x:si>
      </x:sst>`;
    expect(parseSharedStringItems(xml)).toEqual(['titulo', 'Ação 1', 'pendente']);
  });
});
