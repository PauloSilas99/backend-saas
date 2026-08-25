import { isTrivialCellValue } from '@shared/helpers/trivial-cell';

/** Conversão estável de células Excel/CSV — sempre por valor, nunca por array esparso. */

const EXCEL_SERIAL_MIN = 20_000;
const EXCEL_SERIAL_MAX = 80_000;

export function dateToYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Serial Excel (dias desde 1899-12-30), sem deslocar o dia por fuso. */
export function excelSerialToYmd(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) {
    return null;
  }
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function normalizeDateValue(raw: string): { value: string; ok: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: '', ok: true };

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const iso = trimmed.slice(0, 10);
    const d = new Date(`${iso}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return { value: iso, ok: true };
  }

  const br = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    let year = Number(br[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
      return {
        value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        ok: true,
      };
    }
  }

  const asNumber = Number(trimmed.replace(',', '.'));
  const fromSerial = excelSerialToYmd(asNumber);
  if (fromSerial) return { value: fromSerial, ok: true };

  return { value: trimmed, ok: false };
}

export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateToYmd(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const asDate = excelSerialToYmd(value);
    if (asDate) return asDate;
    return String(value);
  }
  if (typeof value === 'object') {
    const record = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof record.text === 'string' && record.text.trim()) return record.text.trim();
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => part.text ?? '').join('').trim();
    }
    if (record.result !== undefined && record.result !== null) {
      return cellToString(record.result);
    }
  }
  return String(value).trim();
}

export function padRow(values: string[], columnCount: number): string[] {
  const next = values.slice(0, columnCount);
  while (next.length < columnCount) next.push('');
  return next;
}

export function rowHasData(values: string[]): boolean {
  return values.some((cell) => !isTrivialCellValue(cell));
}

/**
 * Escolhe a linha de cabeçalho entre as primeiras linhas:
 * mais textos únicos e a linha seguinte com dados.
 */
export function detectHeaderRowIndex(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 15);

  for (let i = 0; i < limit; i += 1) {
    const filled = (rows[i] ?? []).map((cell) => cell.trim()).filter((cell) => !isTrivialCellValue(cell));
    if (filled.length < 2) continue;

    const unique = new Set(filled.map((cell) => cell.toLowerCase()));
    const numeric = filled.filter((cell) => /^[\d.,/\-:]+$/.test(cell)).length;
    const textRatio = (filled.length - numeric) / filled.length;
    const nextFilled = (rows[i + 1] ?? []).filter((cell) => !isTrivialCellValue(cell)).length;
    const score = unique.size * 3 + textRatio * 4 + Math.min(nextFilled, 30) * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}
