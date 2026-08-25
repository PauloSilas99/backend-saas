import { describe, expect, it } from 'vitest';
import {
  PRODUCT_LIMITS,
  MAX_JSON_BODY_BYTES,
  columnQuotaMessage,
  importTruncatedMessage,
  rowQuotaMessage,
  uploadQuotaMessage,
} from './product-limits';

describe('PRODUCT_LIMITS', () => {
  it('keeps free-tier ceilings that fit Neon/Render', () => {
    expect(PRODUCT_LIMITS.maxRowsPerTenant).toBeLessThanOrEqual(20_000);
    expect(PRODUCT_LIMITS.maxColumnsPerSheet).toBeLessThanOrEqual(80);
    expect(PRODUCT_LIMITS.maxUploadMb).toBeLessThanOrEqual(10);
    expect(PRODUCT_LIMITS.maxJsonBodyMb).toBe(1);
    expect(PRODUCT_LIMITS.poolMax).toBeLessThanOrEqual(10);
    expect(MAX_JSON_BODY_BYTES).toBe(1024 * 1024);
  });

  it('explains quotas in Portuguese for the user', () => {
    expect(rowQuotaMessage(15_000)).toMatch(/15[.\s,]000 registros/);
    expect(columnQuotaMessage(80)).toMatch(/80 colunas/);
    expect(uploadQuotaMessage(10)).toMatch(/10 MB/);
    expect(importTruncatedMessage(15_000)).toMatch(/15[.\s,]000/);
  });
});
