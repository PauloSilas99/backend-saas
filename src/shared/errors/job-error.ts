import { AppError } from './AppError';

const PREFIX = 'SHEET_JOB_ERROR';

/** Serializa AppError no failedReason do BullMQ sem vazar stack. */
export function toJobFailure(err: unknown): Error {
  if (err instanceof AppError) {
    return new Error(`${PREFIX}\n${err.code}\n${err.message}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

export function parseJobFailure(failedReason?: string): { code: string; message: string } | undefined {
  if (!failedReason) return undefined;
  if (failedReason.startsWith(`${PREFIX}\n`)) {
    const [, code, ...rest] = failedReason.split('\n');
    return {
      code: code || 'INTERNAL_ERROR',
      message: rest.join('\n') || failedReason,
    };
  }
  return { code: 'INTERNAL_ERROR', message: failedReason };
}
