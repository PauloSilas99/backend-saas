/** Célula sem conteúdo útil (placeholder Excel, zero isolado, erro de fórmula). */
export function isTrivialCellValue(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (t === '-' || t === '—' || t === '–') return true;
  if (/^0+(\.0+)?$/.test(t)) return true;
  if (/^#(REF|N\/A|VALUE|NULL|DIV\/0|NAME|NUM)!$/i.test(t)) return true;
  return false;
}
