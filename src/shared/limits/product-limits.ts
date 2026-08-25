/**
 * Tetos do produto para caber em Neon/Render Free sem degradar a UX paginada.
 * Valores podem ser sobrescritos por env em produção paga.
 */
function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const PRODUCT_LIMITS = {
  /** Linhas por empresa (inclui soft-deleted — ocupam disco). */
  maxRowsPerTenant: intEnv('MAX_ROWS_PER_TENANT', 15_000),
  maxColumnsPerSheet: intEnv('MAX_COLUMNS_PER_SHEET', 80),
  maxUploadMb: intEnv('MAX_UPLOAD_MB', 10),
  maxJsonBodyMb: 1,
  maxPageSize: 100,
  importJsonChunkRows: 120,
  calendarMaxEvents: 2_000,
  /** Specs de gráfico pessoais por planilha (coluna JSONB da membership). */
  maxUserChartsPerSheet: 12,
  poolMax: intEnv('DB_POOL_MAX', 8),
  statementTimeoutMs: intEnv('DB_STATEMENT_TIMEOUT_MS', 15_000),
  sessionCacheTtlSec: 45,
  subscriptionCacheTtlSec: 60,
  sheetMetaCacheTtlSec: 60,
  healthDbStatsTtlMs: 120_000,
  softDeleteRetentionDays: 7,
  authTokenRetentionDays: 14,
} as const;

export const MAX_JSON_BODY_BYTES = PRODUCT_LIMITS.maxJsonBodyMb * 1024 * 1024;
export const MAX_UPLOAD_BYTES = PRODUCT_LIMITS.maxUploadMb * 1024 * 1024;

export function rowQuotaMessage(limit = PRODUCT_LIMITS.maxRowsPerTenant): string {
  return (
    `Limite de ${limit.toLocaleString('pt-BR')} registros por empresa neste ambiente. ` +
    'Remova linhas antigas ou importe um recorte menor da planilha.'
  );
}

export function columnQuotaMessage(limit = PRODUCT_LIMITS.maxColumnsPerSheet): string {
  return `Limite de ${limit} colunas por planilha neste ambiente.`;
}

export function uploadQuotaMessage(limitMb = PRODUCT_LIMITS.maxUploadMb): string {
  return `Arquivo acima de ${limitMb} MB. Envie um recorte menor da planilha.`;
}

export function importJobInProgressMessage(): string {
  return 'Já existe um processamento de planilha em andamento para esta empresa. Aguarde a conclusão.';
}

export function importTruncatedMessage(
  kept: number,
  limit = PRODUCT_LIMITS.maxRowsPerTenant,
): string {
  return (
    `A planilha tem mais linhas do que este ambiente aceita. ` +
    `Foram consideradas as primeiras ${kept.toLocaleString('pt-BR')} ` +
    `de no máximo ${limit.toLocaleString('pt-BR')} registros.`
  );
}
