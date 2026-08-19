import { NextFunction, Request, Response } from 'express';
import { AppError } from '@shared/errors/AppError';
import { logger } from '@shared/logger';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos',
        details: err.flatten(),
      },
    });
    return;
  }

  const multerTooLarge =
    err.name === 'MulterError' &&
    (err as { code?: string }).code === 'LIMIT_FILE_SIZE';

  const bodyTooLarge =
    multerTooLarge ||
    (err as { type?: string; status?: number; statusCode?: number }).type ===
      'entity.too.large' ||
    (err as { status?: number }).status === 413 ||
    (err as { statusCode?: number }).statusCode === 413;

  if (bodyTooLarge) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message:
          'Arquivo ou payload muito grande. Divida a planilha em partes menores ou tente novamente.',
      },
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor',
    },
  });
}
