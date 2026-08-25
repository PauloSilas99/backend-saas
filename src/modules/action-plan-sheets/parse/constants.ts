import { PRODUCT_LIMITS } from '@shared/limits/product-limits';

/** Máximo de linhas de dados (excluindo cabeçalho) lidas por importação. */
export const MAX_IMPORT_ROWS = PRODUCT_LIMITS.maxRowsPerTenant;
/** 10 linhas vazias seguidas encerram a leitura; o que já foi lido segue no fluxo. */
export const MAX_TRAILING_EMPTY_ROWS = 10;
/**
 * Zip bomb: uma única entrada de *dados* (aba / sharedStrings) com inflação absurda.
 * Estilos e imagens do Excel não entram nesta conta.
 */
export const MAX_XLSX_ZIP_RATIO = 80;
/** Teto de uma entrada de dados descomprimida (aba ou textos). */
export const MAX_XLSX_DATA_ENTRY_BYTES = 80 * 1024 * 1024;
/** Linhas físicas extraídas (cabeçalho + dados), além do teto de registros. */
export const MAX_PHYSICAL_EXTRACT_ROWS = MAX_IMPORT_ROWS + 50;
/** Tamanho mínimo de amostra para detecção de magic bytes. */
export const FILE_TYPE_SAMPLE_BYTES = 4100;
