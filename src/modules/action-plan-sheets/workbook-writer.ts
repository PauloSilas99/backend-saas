import ExcelJS from 'exceljs';
import {
  CANONICAL_COLUMNS,
  TEMPLATE_VERSION,
  type CanonicalColumn,
} from '@modules/columns/canonical-catalog';

export const DATA_SHEET_NAME = 'PLANO DE AÇÃO';
export const LISTS_SHEET_NAME = '_listas';

export type WorkbookRow = Record<string, string>;

const BLOCK_COLORS: Record<CanonicalColumn['block'], string> = {
  identificacao: 'FF000000',
  perigo: 'FF4285F4',
  avaliacao: 'FF000000',
  controles: 'FF000000',
  verificacao: 'FFFF6D01',
  calculo_risco: 'FF000000',
  plano_acao: 'FF000000',
  prazos_custo: 'FFFF6D01',
  status: 'FF000000',
  evidencia_validacao: 'FF00B050',
  equipe_campo: 'FF00B0F0',
  reavaliacao: 'FFFFC000',
};

const LIGHT_ON_DARK = new Set(['FF000000', 'FF4285F4', 'FF00B050', 'FFFF6D01']);

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'empresa';
}

export function workbookFileName(empresaNome: string, date: Date): string {
  return `PA_${slug(empresaNome)}_${date.toISOString().slice(0, 10)}.xlsx`;
}

function listRangeName(key: string): string {
  return `Lista_${key}`;
}

function writeLists(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet(LISTS_SHEET_NAME);
  sheet.state = 'veryHidden';
  sheet.getCell('A1').value = `templateVersion=${TEMPLATE_VERSION}`;

  let column = 2; // A guarda a versão; as listas começam em B
  for (const canonical of CANONICAL_COLUMNS) {
    const vocabulary = canonical.vocabulary ?? [];
    if (vocabulary.length === 0) continue;

    const letter = sheet.getColumn(column).letter;
    vocabulary.forEach((option, index) => {
      sheet.getCell(`${letter}${index + 1}`).value = option;
    });
    workbook.definedNames.add(
      `${LISTS_SHEET_NAME}!$${letter}$1:$${letter}$${vocabulary.length}`,
      listRangeName(canonical.key),
    );
    column += 1;
  }
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.height = 46;
  CANONICAL_COLUMNS.forEach((canonical, index) => {
    const cell = header.getCell(index + 1);
    const background = BLOCK_COLORS[canonical.block];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };
    cell.font = {
      bold: true,
      size: 9,
      color: { argb: LIGHT_ON_DARK.has(background) ? 'FFFFFFFF' : 'FF111111' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

function applyValidations(sheet: ExcelJS.Worksheet, dataRows: number): void {
  const lastRow = Math.max(dataRows, 1) + 1;
  for (const canonical of CANONICAL_COLUMNS) {
    if (!canonical.vocabulary?.length) continue;
    for (let row = 2; row <= lastRow; row += 1) {
      sheet.getCell(`${canonical.column}${row}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`=${listRangeName(canonical.key)}`],
        showErrorMessage: !canonical.systemManaged,
        error: 'Use um dos valores da lista.',
      };
    }
  }
}

export async function buildWorkbook(input: {
  empresaNome: string;
  rows?: WorkbookRow[];
}): Promise<Buffer> {
  const rows = input.rows ?? [];
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(DATA_SHEET_NAME);
  sheet.columns = CANONICAL_COLUMNS.map((canonical) => ({
    header: canonical.label,
    key: canonical.key,
    width: canonical.fieldType === 'LONG_TEXT' ? 38 : 18,
  }));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const body = rows.map((row) => CANONICAL_COLUMNS.map((c) => row[c.key] ?? ''));
  sheet.addTable({
    name: 'PlanoDeAcao',
    displayName: 'PlanoDeAcao',
    ref: 'A1',
    headerRow: true,
    columns: CANONICAL_COLUMNS.map((canonical) => ({ name: canonical.label })),
    rows: body.length > 0 ? body : [CANONICAL_COLUMNS.map(() => '')],
  });

  styleHeader(sheet);
  writeLists(workbook);
  applyValidations(sheet, body.length);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export type ExportableRow = {
  externalKey: string | null;
  cells: Record<string, unknown>;
};

export function rowsToWorkbookRows(
  rows: ExportableRow[],
  columns: Array<{ id: string; canonicalKey: string | null }>,
): WorkbookRow[] {
  const keyByColumnId = new Map<string, string>();
  for (const column of columns) {
    if (column.canonicalKey) keyByColumnId.set(column.id, column.canonicalKey);
  }

  return rows.map((row) => {
    const out: WorkbookRow = { id: row.externalKey ?? '' };
    for (const [columnId, raw] of Object.entries(row.cells ?? {})) {
      const key = keyByColumnId.get(columnId);
      if (!key || raw === null || raw === undefined) continue;
      out[key] = String(raw);
    }
    return out;
  });
}
