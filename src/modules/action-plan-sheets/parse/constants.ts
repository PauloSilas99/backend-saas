import { PRODUCT_LIMITS } from '@shared/limits/product-limits';

/** Máximo de linhas de dados (excluindo cabeçalho) lidas por importação. */
export const MAX_IMPORT_ROWS = PRODUCT_LIMITS.maxRowsPerTenant;
/** 10 linhas vazias seguidas encerram a leitura; o que já foi lido segue no fluxo. */
export const MAX_TRAILING_EMPTY_ROWS = 10;
/** Tamanho máximo descomprimido permitido para arquivos .xlsx (proteção zip bomb). */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
/** Tamanho mínimo de amostra para detecção de magic bytes. */
export const FILE_TYPE_SAMPLE_BYTES = 4100;
