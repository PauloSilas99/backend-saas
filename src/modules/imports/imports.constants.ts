/** Máximo de linhas de dados (excluindo cabeçalho) aceitas por importação. */
export const MAX_IMPORT_ROWS = 50_000;

/** Tamanho máximo descomprimido permitido para arquivos .xlsx (proteção zip bomb). */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/** Limite padrão de paginação para preview e listagem. */
export const DEFAULT_PAGE_SIZE = 50;

/** Tamanho mínimo de amostra para detecção de magic bytes. */
export const FILE_TYPE_SAMPLE_BYTES = 4100;

/**
 * Política padrão de commit: linhas com status ERROR são ignoradas;
 * apenas linhas OK/WARNING são persistidas. O job finaliza como PARTIAL
 * se houver linhas com erro ignoradas, ou COMPLETED se todas forem OK/WARNING.
 */
export const DEFAULT_COMMIT_POLICY = 'skip_errors' as const;

export type CommitPolicy = typeof DEFAULT_COMMIT_POLICY | 'block_on_errors';

export const IMPORT_QUEUE_NAME = 'imports';

export const IMPORT_JOB_TYPES = {
  PARSE: 'parse',
  VALIDATE: 'validate',
  COMMIT: 'commit',
} as const;

export type ImportJobType = (typeof IMPORT_JOB_TYPES)[keyof typeof IMPORT_JOB_TYPES];
