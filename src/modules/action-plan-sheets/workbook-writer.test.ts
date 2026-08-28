import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { CANONICAL_COLUMNS, TEMPLATE_VERSION } from '@modules/columns/canonical-catalog';
import {
  DATA_SHEET_NAME,
  LISTS_SHEET_NAME,
  buildWorkbook,
  rowsToWorkbookRows,
  workbookFileName,
} from './workbook-writer';

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('workbookFileName', () => {
  it('nomeia por empresa e data, para dois planos não nascerem com o mesmo título', () => {
    expect(workbookFileName('Construtora São José', new Date('2026-08-28T12:00:00Z'))).toBe(
      'PA_construtora-sao-jose_2026-08-28.xlsx',
    );
  });

  it('tolera nome vazio', () => {
    expect(workbookFileName('   ', new Date('2026-08-28T12:00:00Z'))).toBe(
      'PA_empresa_2026-08-28.xlsx',
    );
  });
});

describe('buildWorkbook — estrutura', () => {
  it('traz as 56 colunas do catálogo, na ordem do arquivo', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    const headers = CANONICAL_COLUMNS.map((_, i) => ws.getRow(1).getCell(i + 1).value);
    expect(headers).toEqual(CANONICAL_COLUMNS.map((c) => c.label));
  });

  it('põe a última coluna em BD', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    expect(ws.getCell('BD1').value).toBe('NOVO NR');
  });

  it('congela a linha de cabeçalho', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('estende a tabela até BD — no arquivo do cliente ela parava em AA', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    const table = (ws as unknown as { tables: Record<string, { table: { tableRef: string } }> })
      .tables;
    const ref = Object.values(table)[0].table.tableRef;
    expect(ref.startsWith('A1:BD')).toBe(true);
  });

  it('esconde a aba de listas', async () => {
    const wb = await read(await buildWorkbook({ empresaNome: 'Acme' }));
    expect(wb.getWorksheet(LISTS_SHEET_NAME)!.state).toBe('veryHidden');
  });

  it('registra a versão do modelo', async () => {
    const wb = await read(await buildWorkbook({ empresaNome: 'Acme' }));
    const listas = wb.getWorksheet(LISTS_SHEET_NAME)!;
    expect(listas.getCell('A1').value).toBe(`templateVersion=${TEMPLATE_VERSION}`);
  });
});

describe('buildWorkbook — validações que estavam quebradas no original', () => {
  it('dá lista fechada à prioridade, apontando para nome definido', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    const validation = ws.getCell('AG2').dataValidation;
    expect(validation?.type).toBe('list');
    expect(validation?.formulae?.[0]).not.toContain('#REF!');
  });

  it('dá lista fechada ao status atual', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    expect(ws.getCell('AP2').dataValidation?.type).toBe('list');
  });

  it('não deixa nenhuma fórmula de validação apontando para #REF!', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    for (const column of CANONICAL_COLUMNS) {
      const formulae = ws.getCell(`${column.column}2`).dataValidation?.formulae ?? [];
      for (const formula of formulae) {
        expect(String(formula)).not.toContain('#REF!');
      }
    }
  });
});

describe('buildWorkbook — dados', () => {
  it('modelo em branco traz uma linha vazia, pronta para preencher', async () => {
    const ws = (await read(await buildWorkbook({ empresaNome: 'Acme' }))).getWorksheet(
      DATA_SHEET_NAME,
    )!;
    const preenchidas = CANONICAL_COLUMNS.filter(
      (c) => String(ws.getCell(`${c.column}2`).value ?? '') !== '',
    );
    expect(preenchidas).toEqual([]);
  });

  it('exportação põe cada valor na coluna da sua chave canônica', async () => {
    const buffer = await buildWorkbook({
      empresaNome: 'Acme',
      rows: [{ id: 'A-0001', acoes: 'Trocar guarda-corpo', prazo: '2026-09-30' }],
    });
    const ws = (await read(buffer)).getWorksheet(DATA_SHEET_NAME)!;
    expect(ws.getCell('A2').value).toBe('A-0001');
    expect(ws.getCell('AF2').value).toBe('Trocar guarda-corpo');
    expect(ws.getCell('AM2').value).toBe('2026-09-30');
  });

  it('ignora chave que não existe no catálogo', async () => {
    const buffer = await buildWorkbook({
      empresaNome: 'Acme',
      rows: [{ acoes: 'Trocar guarda-corpo', coluna_inventada: 'lixo' }],
    });
    const ws = (await read(buffer)).getWorksheet(DATA_SHEET_NAME)!;
    expect(ws.getCell('AF2').value).toBe('Trocar guarda-corpo');
  });
});

describe('rowsToWorkbookRows', () => {
  const columns = [
    { id: 'c1', canonicalKey: 'acoes' },
    { id: 'c2', canonicalKey: 'prazo' },
    { id: 'c3', canonicalKey: null },
  ];

  it('traduz células por id para chaves canônicas', () => {
    const result = rowsToWorkbookRows(
      [{ externalKey: 'A-0001', cells: { c1: 'Trocar EPI', c2: '2026-09-30' } }],
      columns,
    );
    expect(result).toEqual([{ id: 'A-0001', acoes: 'Trocar EPI', prazo: '2026-09-30' }]);
  });

  it('ignora coluna dinâmica, que não tem lugar no modelo', () => {
    const result = rowsToWorkbookRows(
      [{ externalKey: null, cells: { c1: 'Trocar EPI', c3: 'valor livre' } }],
      columns,
    );
    expect(result[0]).not.toHaveProperty('c3');
    expect(Object.values(result[0])).not.toContain('valor livre');
  });

  it('deixa o ID vazio quando a linha ainda não tem chave externa', () => {
    const result = rowsToWorkbookRows([{ externalKey: null, cells: {} }], columns);
    expect(result[0].id).toBe('');
  });

  it('converte valores não textuais para texto', () => {
    const result = rowsToWorkbookRows(
      [{ externalKey: 'A-0002', cells: { c1: 42 as unknown as string } }],
      columns,
    );
    expect(result[0].acoes).toBe('42');
  });
});
