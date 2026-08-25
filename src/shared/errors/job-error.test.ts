import { describe, expect, it } from 'vitest';
import { QuotaError, ValidationError } from './AppError';
import { parseJobFailure, toJobFailure } from './job-error';

describe('job-error', () => {
  it('round-trips AppError code and message for BullMQ', () => {
    const thrown = toJobFailure(new QuotaError('Limite de registros'));
    const parsed = parseJobFailure(thrown.message);
    expect(parsed).toEqual({ code: 'QUOTA_EXCEEDED', message: 'Limite de registros' });
  });

  it('keeps unknown failures as INTERNAL_ERROR', () => {
    expect(parseJobFailure('socket hang up')).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'socket hang up',
    });
  });

  it('preserves ValidationError code', () => {
    const thrown = toJobFailure(new ValidationError('Cabeçalho vazio'));
    expect(parseJobFailure(thrown.message)?.code).toBe('VALIDATION_ERROR');
  });
});
